const fs = require('fs');
const lzma = require('lzma');

class OSRParser {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }

    readByte() {
        const val = this.buffer.readUInt8(this.offset);
        this.offset += 1;
        return val;
    }

    readShort() {
        const val = this.buffer.readUInt16LE(this.offset);
        this.offset += 2;
        return val;
    }

    readInt() {
        const val = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return val;
    }

    readLong() {
        // Usa readBigInt64LE si node es suficientemente nuevo
        const val = this.buffer.readBigInt64LE(this.offset);
        this.offset += 8;
        return val;
    }

    readULEB128() {
        let result = 0;
        let shift = 0;
        while (true) {
            const byte = this.readByte();
            result |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return result;
    }

    readString() {
        const flag = this.readByte();
        if (flag === 0x00) {
            return '';
        }
        if (flag === 0x0b) {
            const length = this.readULEB128();
            const str = this.buffer.toString('utf8', this.offset, this.offset + length);
            this.offset += length;
            return str;
        }
        return '';
    }

    parse() {
        try {
            const data = {};
            data.gameMode = this.readByte();
            data.gameVersion = this.readInt();
            data.beatmapMD5 = this.readString();
            data.playerName = this.readString();
            data.replayMD5 = this.readString();
            data.count300 = this.readShort();
            data.count100 = this.readShort();
            data.count50 = this.readShort();
            data.countGeki = this.readShort();
            data.countKatu = this.readShort();
            data.countMiss = this.readShort();
            data.totalScore = this.readInt();
            data.maxCombo = this.readShort();
            data.perfect = this.readByte() === 1;
            data.mods = this.readInt();
            data.lifeBar = this.readString();
            data.timestamp = this.readLong();
            data.replayLength = this.readInt();
            // We can skip parsing the actual replay data since it's compressed lzma.
            this.offset += data.replayLength;
            if (this.offset + 8 <= this.buffer.length) {
                data.scoreId = this.readLong();
            } else {
                data.scoreId = 0n;
            }
            
            // Lazer Extra JSON
            const extra = this.buffer.slice(this.offset);
            if (extra.length > 4) {
                const len = extra.readUInt32LE(0);
                const lzmaData = extra.slice(4);
                try {
                    const decompressed = lzma.decompress(lzmaData);
                    data.lazerScoreInfo = JSON.parse(decompressed.toString('utf8'));
                } catch {}
            }
            
            return data;
        } catch (e) {
            console.error("Error parsing osr:", e);
            return null;
        }
    }
}

function parseOSR(buffer) {
    const parser = new OSRParser(buffer);
    return parser.parse();
}

module.exports = { parseOSR, OSRParser };
