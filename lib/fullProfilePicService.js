'use strict';

const { S_WHATSAPP_NET, jidNormalizedUser } = require('@whiskeysockets/baileys');

let jimpModule = null;
try {
    jimpModule = require('jimp');
} catch (_) {}

let sharpModule = null;
try {
    sharpModule = require('sharp');
} catch (_) {}

const MAX_DP_DIMENSION = 720;

/**
 * Process an image buffer into a full uncropped WhatsApp profile picture (<= 720x720 JPEG).
 * Supports Jimp v1 ({ Jimp, JimpMime }), legacy Jimp v0, and optional sharp fallback.
 *
 * @param {Buffer|string} input - Image Buffer or local file path
 * @returns {Promise<{ img: Buffer, preview: Buffer, width: number, height: number, originalWidth: number, originalHeight: number, sizeBytes: number }>}
 */
async function generateFullProfilePicture(input) {
    if (!input || (Buffer.isBuffer(input) && input.length === 0)) {
        throw new Error('Empty image buffer provided.');
    }

    // 1. Primary: Jimp v1.x ({ Jimp, JimpMime })
    if (jimpModule && jimpModule.Jimp && typeof jimpModule.Jimp.read === 'function') {
        const { Jimp, JimpMime } = jimpModule;
        const mimeJpeg = (JimpMime && JimpMime.jpeg) || 'image/jpeg';

        const image = await Jimp.read(input);
        const originalWidth = image.width;
        const originalHeight = image.height;

        if (!originalWidth || !originalHeight) {
            throw new Error('Could not read valid image dimensions.');
        }

        // Preserve full uncropped frame and proportionally fit inside 720x720
        const fullFrame = image.clone();
        fullFrame.crop({ x: 0, y: 0, w: originalWidth, h: originalHeight });
        fullFrame.scaleToFit({ w: MAX_DP_DIMENSION, h: MAX_DP_DIMENSION });

        const width = fullFrame.width;
        const height = fullFrame.height;
        const img = await fullFrame.getBuffer(mimeJpeg, { quality: 88 });

        let preview = img;
        try {
            const previewImg = fullFrame.clone();
            if (typeof previewImg.normalize === 'function') {
                previewImg.normalize();
            }
            preview = await previewImg.getBuffer(mimeJpeg, { quality: 82 });
        } catch (_) {
            preview = img;
        }

        return {
            img,
            preview,
            width,
            height,
            originalWidth,
            originalHeight,
            sizeBytes: img.length,
        };
    }

    // 2. Legacy Jimp v0.x fallback
    if (jimpModule && typeof jimpModule.read === 'function') {
        const image = await jimpModule.read(input);
        const originalWidth = image.getWidth();
        const originalHeight = image.getHeight();
        const cropped = image.crop(0, 0, originalWidth, originalHeight);
        const scaled = cropped.scaleToFit(MAX_DP_DIMENSION, MAX_DP_DIMENSION);
        const mimeJpeg = jimpModule.MIME_JPEG || 'image/jpeg';
        const img = await scaled.getBufferAsync(mimeJpeg);
        let preview = img;
        try {
            preview = await scaled.clone().normalize().getBufferAsync(mimeJpeg);
        } catch (_) {}

        return {
            img,
            preview,
            width: scaled.getWidth(),
            height: scaled.getHeight(),
            originalWidth,
            originalHeight,
            sizeBytes: img.length,
        };
    }

    // 3. Sharp fallback
    if (sharpModule) {
        const meta = await sharpModule(input).metadata();
        const originalWidth = meta.width || MAX_DP_DIMENSION;
        const originalHeight = meta.height || MAX_DP_DIMENSION;
        const { data: img, info } = await sharpModule(input)
            .rotate()
            .resize({
                width: MAX_DP_DIMENSION,
                height: MAX_DP_DIMENSION,
                fit: 'inside',
                withoutEnlargement: false,
            })
            .jpeg({ quality: 88, mozjpeg: true })
            .toBuffer({ resolveWithObject: true });

        return {
            img,
            preview: img,
            width: info.width,
            height: info.height,
            originalWidth,
            originalHeight,
            sizeBytes: img.length,
        };
    }

    throw new Error('No image processing library (jimp or sharp) is available.');
}

function normalizeGroupJid(groupJid) {
    const raw = String(groupJid || '').trim();
    if (!raw) return '';
    if (raw.endsWith('@g.us')) return raw;
    if (/^\d+(-\d+)?$/.test(raw)) return `${raw}@g.us`;
    return raw;
}

/**
 * Apply a full uncropped profile picture to either the active connected WhatsApp account
 * (Personal DP) or a specific WhatsApp Group (Group DP) using Baileys raw w:profile:picture IQ.
 *
 * @param {object} sock - Active connected Baileys socket
 * @param {Buffer} imageBuffer - Source image buffer
 * @param {{ targetType?: 'personal'|'group', groupJid?: string }} options
 */
async function setFullProfilePicture(sock, imageBuffer, options = {}) {
    if (!sock || typeof sock.query !== 'function') {
        throw new Error('WhatsApp session is not connected. Pair your WhatsApp device first.');
    }

    const targetType = String(options.targetType || 'personal').toLowerCase() === 'group' ? 'group' : 'personal';
    const processed = await generateFullProfilePicture(imageBuffer);
    const { img } = processed;

    if (targetType === 'group') {
        const groupJid = normalizeGroupJid(options.groupJid);
        if (!groupJid || !groupJid.endsWith('@g.us')) {
            throw new Error('Please select a valid WhatsApp Group (ending in @g.us).');
        }

        await sock.query({
            tag: 'iq',
            attrs: {
                target: groupJid,
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'w:profile:picture',
            },
            content: [
                {
                    tag: 'picture',
                    attrs: { type: 'image' },
                    content: img,
                },
            ],
        });

        return {
            success: true,
            targetType: 'group',
            targetJid: groupJid,
            originalWidth: processed.originalWidth,
            originalHeight: processed.originalHeight,
            width: processed.width,
            height: processed.height,
            sizeBytes: processed.sizeBytes,
            updatedAt: new Date().toISOString(),
        };
    }

    // Personal DP via raw IQ (preserves full uncropped aspect ratio inside 720x720)
    const selfJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
    try {
        await sock.query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'w:profile:picture',
            },
            content: [
                {
                    tag: 'picture',
                    attrs: { type: 'image' },
                    content: img,
                },
            ],
        });
    } catch (primaryErr) {
        // Retry with explicit target attribute if required by Baileys/WhatsApp server version
        if (selfJid) {
            await sock.query({
                tag: 'iq',
                attrs: {
                    target: selfJid,
                    to: S_WHATSAPP_NET,
                    type: 'set',
                    xmlns: 'w:profile:picture',
                },
                content: [
                    {
                        tag: 'picture',
                        attrs: { type: 'image' },
                        content: img,
                    },
                ],
            });
        } else {
            throw primaryErr;
        }
    }

    return {
        success: true,
        targetType: 'personal',
        targetJid: selfJid || S_WHATSAPP_NET,
        originalWidth: processed.originalWidth,
        originalHeight: processed.originalHeight,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.sizeBytes,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * List active WhatsApp groups from the connected socket for the Dashboard Group DP selector.
 */
async function listActiveGroups(sock) {
    if (!sock || typeof sock.groupFetchAllParticipating !== 'function') {
        return [];
    }

    const rawGroups = await sock.groupFetchAllParticipating();
    const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
    const botDigits = botJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const botLidDigits = sock.user?.lid ? String(sock.user.lid).split('@')[0].split(':')[0].replace(/\D/g, '') : '';

    const groups = Object.values(rawGroups || {}).map((g) => {
        const participants = Array.isArray(g.participants) ? g.participants : [];
        const botParticipant = participants.find((p) => {
            const pId = String(p.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            const pPhone = String(p.phoneNumber || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            return (botDigits && (pId === botDigits || pPhone === botDigits)) || (botLidDigits && pId === botLidDigits);
        });
        const isBotAdmin = Boolean(botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin'));
        return {
            jid: g.id,
            subject: g.subject || g.id,
            participantsCount: participants.length || g.size || 0,
            restrict: Boolean(g.restrict),
            isBotAdmin,
            canEditIcon: !g.restrict || isBotAdmin,
        };
    });

    groups.sort((a, b) => {
        if (a.canEditIcon !== b.canEditIcon) return a.canEditIcon ? -1 : 1;
        return String(a.subject || '').localeCompare(String(b.subject || ''));
    });

    return groups;
}

/**
 * Read current connected WhatsApp profile info and avatar URL.
 */
async function getCurrentProfileInfo(sock) {
    if (!sock || !sock.user?.id) {
        return {
            connected: false,
            userJid: null,
            phone: null,
            name: null,
            avatarUrl: null,
        };
    }

    const userJid = jidNormalizedUser(sock.user.id);
    const phone = userJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    let avatarUrl = null;
    try {
        if (typeof sock.profilePictureUrl === 'function') {
            avatarUrl = await sock.profilePictureUrl(userJid, 'image');
        }
    } catch (_) {
        try {
            if (typeof sock.profilePictureUrl === 'function') {
                avatarUrl = await sock.profilePictureUrl(userJid);
            }
        } catch (__) {
            avatarUrl = null;
        }
    }

    return {
        connected: true,
        userJid,
        phone,
        name: sock.user?.name || `+${phone}`,
        avatarUrl,
    };
}

module.exports = {
    MAX_DP_DIMENSION,
    generateFullProfilePicture,
    setFullProfilePicture,
    listActiveGroups,
    getCurrentProfileInfo,
};
