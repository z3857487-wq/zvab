'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { bot } = require('../lib/pluginLoader');
const { setFullProfilePicture } = require('../lib/fullProfilePicService');
const { isButtonModeOn, sendButtonMessage } = require('../lib/buttonHelper');

/**
 * Unwrap ephemeral / viewOnce / documentWithCaption wrappers to locate an imageMessage.
 */
function unwrapMessageContent(content) {
    if (!content || typeof content !== 'object') return null;
    let cur = content;
    for (let i = 0; i < 6; i++) {
        if (!cur) break;
        if (cur.ephemeralMessage?.message) {
            cur = cur.ephemeralMessage.message;
        } else if (cur.viewOnceMessage?.message) {
            cur = cur.viewOnceMessage.message;
        } else if (cur.viewOnceMessageV2?.message) {
            cur = cur.viewOnceMessageV2.message;
        } else if (cur.viewOnceMessageV2Extension?.message) {
            cur = cur.viewOnceMessageV2Extension.message;
        } else if (cur.documentWithCaptionMessage?.message) {
            cur = cur.documentWithCaptionMessage.message;
        } else {
            break;
        }
    }
    return cur;
}

function extractImageSource(message) {
    const inner = unwrapMessageContent(message?.message);
    if (!inner) return null;

    // 1. Direct image with .fdp caption
    if (inner.imageMessage) {
        return { mediaMsg: inner.imageMessage, mediaType: 'image' };
    }

    // 2. Quoted image (reply to any photo, including view-once or forwarded photo)
    const contextInfo =
        inner.extendedTextMessage?.contextInfo ||
        inner.imageMessage?.contextInfo ||
        inner.videoMessage?.contextInfo ||
        inner.buttonsResponseMessage?.contextInfo ||
        inner.templateButtonReplyMessage?.contextInfo ||
        null;

    const quotedRaw = contextInfo?.quotedMessage;
    if (!quotedRaw) return null;

    const quoted = unwrapMessageContent(quotedRaw);
    if (!quoted) return null;

    if (quoted.imageMessage) {
        return { mediaMsg: quoted.imageMessage, mediaType: 'image' };
    }
    if (quoted.documentMessage && /^image\//i.test(quoted.documentMessage.mimetype || '')) {
        return { mediaMsg: quoted.documentMessage, mediaType: 'document' };
    }
    return null;
}

async function downloadMediaBuffer(mediaMsg, mediaType) {
    const stream = await downloadContentFromMessage(mediaMsg, mediaType);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function handleFullProfilePicCommand(sock, chatId, message, args = [], query = '', ctx = {}) {
    const prefix = ctx?.effectivePrefix || '.';
    const cmdName = String(ctx?.c || 'fdp').toLowerCase();
    const arg0 = String(args?.[0] || '').trim().toLowerCase();
    const isGroupChat = String(chatId || '').endsWith('@g.us');

    const wantsGroupDp =
        cmdName === 'fgdp' ||
        cmdName === 'fullgpp' ||
        arg0 === 'group' ||
        arg0 === 'gc' ||
        arg0 === 'g';

    const imageSource = extractImageSource(message);
    if (!imageSource) {
        const usageText =
            `🖼️ *Full No-Crop Profile Picture*\n\n` +
            `Reply to any photo (or send a photo with caption) using:\n` +
            `• *${prefix}fdp* — Set full uncropped Personal DP\n` +
            `• *${prefix}fdp group* or *${prefix}fgdp* — Set full uncropped Group DP\n\n` +
            `_No square cropping — your entire photo fits cleanly inside WhatsApp's 720px frame._`;

        if (isButtonModeOn()) {
            await sendButtonMessage(sock, chatId, {
                text: usageText,
                footer: 'Zaid Ashiq X Ultra V. Coder • Full Profile Pic',
                buttons: [
                    { id: `${prefix}menu`, text: '📜 Open Menu' },
                    { id: `${prefix}ping`, text: '⚡ Bot Status' },
                ],
            }, message);
        } else {
            await sock.sendMessage(chatId, { text: usageText }, { quoted: message });
        }
        return;
    }

    if (wantsGroupDp && !isGroupChat) {
        await sock.sendMessage(
            chatId,
            { text: `❌ To update a Group DP, run *${prefix}fdp group* or *${prefix}fgdp* inside that WhatsApp group.` },
            { quoted: message }
        );
        return;
    }

    // Processing reaction
    try {
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
    } catch (_) {}

    try {
        const buffer = await downloadMediaBuffer(imageSource.mediaMsg, imageSource.mediaType);
        if (!buffer || buffer.length === 0) {
            throw new Error('Could not download the replied image. Please send or reply to the photo again.');
        }

        const result = await setFullProfilePicture(sock, buffer, {
            targetType: wantsGroupDp ? 'group' : 'personal',
            groupJid: wantsGroupDp ? chatId : '',
        });

        try {
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        } catch (_) {}

        const modeLabel = wantsGroupDp ? 'Group Profile Picture' : 'Personal Profile Picture';
        const kb = (result.sizeBytes / 1024).toFixed(1);
        const successText =
            `✅ *Full ${modeLabel} Updated (No Crop)!*\n\n` +
            `• *Original:* ${result.originalWidth}×${result.originalHeight}px\n` +
            `• *Applied:* ${result.width}×${result.height}px (${kb} KB)\n` +
            `• *Mode:* ${wantsGroupDp ? 'Group DP' : 'Personal DP'}`;

        if (isButtonModeOn()) {
            await sendButtonMessage(sock, chatId, {
                text: successText,
                footer: 'Zaid Ashiq X Ultra V. Coder • Full Profile Pic',
                buttons: [
                    { id: `${prefix}menu`, text: '📜 Main Menu' },
                    { id: `${prefix}alive`, text: '⚡ Bot Status' },
                ],
            }, message);
        } else {
            await sock.sendMessage(chatId, { text: successText }, { quoted: message });
        }
    } catch (err) {
        console.error('[fullpp] Error setting full profile picture:', err);
        try {
            await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        } catch (_) {}

        const hint = wantsGroupDp
            ? '\n_Make sure the bot is a Group Admin if this group restricts icon edits to admins._'
            : '';
        await sock.sendMessage(
            chatId,
            { text: `❌ *Failed to update Full Profile Picture*\n${err?.message || 'Unknown error'}${hint}` },
            { quoted: message }
        );
    }
}

bot({
    command: ['fdp', 'fullpp', 'fulldp', 'fgdp', 'fullgpp'],
    description: 'Reply to any photo to set full uncropped Personal or Group DP (.fdp / .fdp group / .fgdp)',
    category: 'owner',
}, async (sock, chatId, message, args, query, ctx) => {
    await handleFullProfilePicCommand(sock, chatId, message, args, query, ctx);
});

module.exports = { handleFullProfilePicCommand };
