const channelPlayTypeCache = new Map();

function setChannelRecentPlayType(channelId, beatmapId, isLazer) {
    if (!channelId) return;
    channelPlayTypeCache.set(channelId, {
        beatmapId: beatmapId ? beatmapId.toString() : null,
        isLazer: !!isLazer
    });
}

function getChannelRecentPlayType(channelId, beatmapId) {
    if (!channelId) return null;
    const cached = channelPlayTypeCache.get(channelId);
    if (!cached) return null;
    if (beatmapId) {
        if (cached.beatmapId === beatmapId.toString()) {
            return cached.isLazer ? 'lazer' : 'stable';
        }
        return null;
    }
    return cached.isLazer ? 'lazer' : 'stable';
}

module.exports = {
    setChannelRecentPlayType,
    getChannelRecentPlayType
};
