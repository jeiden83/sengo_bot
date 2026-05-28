const channelPlayTypeCache = new Map();

function setChannelRecentPlayType(channelId, beatmapId, isLazer) {
    if (!channelId || !beatmapId) return;
    channelPlayTypeCache.set(channelId, {
        beatmapId: beatmapId.toString(),
        isLazer: !!isLazer
    });
}

function getChannelRecentPlayType(channelId, beatmapId) {
    if (!channelId || !beatmapId) return null;
    const cached = channelPlayTypeCache.get(channelId);
    if (cached && cached.beatmapId === beatmapId.toString()) {
        return cached.isLazer ? 'lazer' : 'stable';
    }
    return null;
}

module.exports = {
    setChannelRecentPlayType,
    getChannelRecentPlayType
};
