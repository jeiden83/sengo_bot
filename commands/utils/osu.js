const OsuUserModel = require("../../models/OsuUserModel.js");
const BeatmapModel = require("../../models/BeatmapModel.js");
const OsuScoreModel = require("../../models/OsuScoreModel.js");


const {
    argsParser,
    argsParserNoCommand,
    findBeatmapInChannel,
    parsingCommandFunction
} = require("./argsParser.js");

// Funciones de gap y preload movidas a OsuScoreModel.js

module.exports = { 
    handlePredictivePreload: OsuScoreModel.handlePredictivePreload,
    triggerBackgroundOsuPreload: OsuScoreModel.triggerBackgroundOsuPreload, 
    getUnrankedUserScores: OsuScoreModel.getUnrankedUserScores, 
    NewloadToken: OsuUserModel.NewloadToken, 
    getNewBeatmapUserScores: OsuScoreModel.getNewBeatmapUserScores,
    getUnrankedBeatmapUserAllScores: OsuScoreModel.getUnrankedBeatmapUserAllScores,
    getBeatmap_osu: BeatmapModel.getBeatmap_osu,
    saveUserscore: OsuScoreModel.saveUserscore,
    getUserRecentScores: OsuScoreModel.getUserRecentScores,
    getUserTopScores: OsuScoreModel.getUserTopScores,
    getBeatmap: BeatmapModel.getBeatmap,
    getOsuPpsData: BeatmapModel.getOsuPpsData,
    lookupBeatmapByMD5: BeatmapModel.lookupBeatmapByMD5,
    getScoreDetails: OsuScoreModel.getScoreDetails,
    findBeatmapInChannel,
    parsingCommandFunction,
    getBeatmapUserScore: OsuScoreModel.getBeatmapUserScore,
    loadToken: OsuUserModel.loadToken, 
    getOsuUser: OsuUserModel.getOsuUser, 
    getRecentScores: OsuScoreModel.getRecentScores, 
    argsParser, 
    argsParserNoCommand, 
    getBeatmapUserAllScores: OsuScoreModel.getBeatmapUserAllScores,
    calculatePP: OsuScoreModel.calculatePP,
    triggerBackgroundGapCache: OsuScoreModel.triggerBackgroundGapCache,
    triggerBackgroundRecentPreload: OsuScoreModel.triggerBackgroundRecentPreload,
    normalizeScore: OsuScoreModel.normalizeScore,
    normalizeStatistics: OsuScoreModel.normalizeStatistics,
    getBeatmapsetTags: BeatmapModel.getBeatmapsetTags,
    fetchRankingPage: OsuUserModel.fetchRankingPage
}