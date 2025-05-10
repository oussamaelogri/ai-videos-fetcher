const admin = require('firebase-admin');
const axios = require('axios');
const { format } = require('date-fns');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_DAILY_VIDEOS = 40;
const TARGET_HOUR = 18;
const REQUEST_DELAY = 1500;

const CHANNELS = [
'UC-v_CmOijyT8QVWq9H_1qfg', // AuraForge
'UCZE_XnY_UazcRILVru7znDw', // Khalid Al Ameri
'UChOPyo-uWLVi5uO53mSBX-w', // Noor Stars 
'UCwBGFE-r7YeFFHT7JmxWPgg', // Ossy Marwah 
'UCWKF7jRIPLVBcnE2p993yAg', // Bessan Ismail
'UCdcZhYtGKo8n1VRLgxMe_hA', // Kika Kim
'UCYJHVw7OYgtwiNks92eag5Q', // simba17 official
'UCFGZTrhn2GbEsgQ8-12-rIA', // Ghaith Marwan
'UCoWHUkZf4bATsTlnqcNVPfw', // Bjlife
'UCxEGVXh6fi-XYo58NZrbIHQ', // BanderitaX
'UC9Z-zmiY4J3KGe_aNPATSeA', // Basma if
'UCXnKd1R2a7ebk6hvIzS57WA', // Osama
'UCVEvXfblll0OjxBE_I9YeOw',  // Karadenizli Maceracı
'UCTO40euu-crofOMmL3SULqg', // CHICKEN BALALM
'UC0fvGpDXi7sV2hbgD-O47yw', // Amaury Guichon
'UC7Vr_TnuV66BKKHQ5qOsUKA', // Yasser Ahmed
'UCXxjVrHdBLJV0EhOczWTw0g', // Low Budget Ball
'UC7108gLyg2hCacGQtH3UqZQ', // Stillworse
'UCm_K3dRBOVt3rHLtPsjVSjA', // Marc Ruiz
'UCrw49J13uH1oElsUC3q_1pw', // N
'UChHje2tB0q8m-kCaNdJVDmA', // Hdit W Kora
'UCkwICkGluKZ8ZJVVQFQ-pdQ', // abdel abdou
'UCjDeNOJxVmNTlP2AfAfPzbw', // Ali ball
'UCvQ0oz1NhZZU7-LC8z7KGuA', // Dm football
'UC2bW_AY9BlbYLGJSXAbjS4Q', // Live Speedy
'UCU8bQExxd38i-mnn-GLOtfA', // UFC Eurasia
'UCGmnsW623G1r-Chmo5RB4Yw', // JJ Olatunji
'UCmf_VrB73I-eJ3fq0adaOkg', // mkbHD
'UCMiJRAwDNSNzuYeN2uWa0pA', // Mrwhosetheboss
'UCdqs-ItofPRWvLm3mM1dNlg', // TechDroider
'UCtxD0x6AuNNqdXO9Wp5GHew', // URCristiano
'UC5CA3F_2LalVkbYpJq3MGhw', // Naifh Alehydeb
'UCvPW1W4WlpTgNezZzwIstLA', // Nogla
'UC0Wju2yvRlfwqraLlz5152Q', // PANDA BOI
'UCcveFkjpctOZwCsfp5hVLyg', // ZachChoi
'UCmoMmj6q312Grl9zN-0z65g', // candy
'UCjdrGjv4bGt5HvApBe1HADQ', // EBB Super Star
'UCdN6LdWhEyiA2u7LPonxz9Q', // Real Aryan khan
'UCaFUrR3oSxOl5Y9y6tvLTEg', // WillNE
'UC0DRTkIeQW27Lk4h1tkc6ew'  // Elias Dosunmu
];

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});
const db = admin.firestore();

const channelCache = new Map();

async function fetchVideos() {
    try {
        if (!isRightTime()) {
            console.log('⏳ Not the scheduled time (6 PM Morocco)');
            return;
        }

        if (await isDailyLimitReached()) {
            console.log(`🎯 Daily limit reached (${MAX_DAILY_VIDEOS} videos)`);
            return;
        }

        const videos = await fetchAllVideos();
        
        if (videos.length > 0) {
            await saveVideos(videos);
            console.log(
                `✅ Added ${videos.length} videos\n` +
                `📊 Quota used: ${calculateQuota(videos.length)} units\n` +
                `⏰ ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
            );
        } else {
            console.log('⚠️ No new videos found today');
        }

        await logExecution(videos.length);

    } catch (error) {
        console.error('❌ Main error:', error);
        await logError(error);
        process.exit(0);
    }
}

function isRightTime() {
    const now = new Date();
    const moroccoTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' }));
    return moroccoTime.getHours() === TARGET_HOUR;
}

async function isDailyLimitReached() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const snapshot = await db.collection('videos')
        .where('timestamp', '>=', todayStart)
        .count()
        .get();

    return snapshot.data().count >= MAX_DAILY_VIDEOS;
}

async function fetchAllVideos() {
    const videos = [];
    
    for (const channelId of CHANNELS) {
        try {
            await delay(REQUEST_DELAY);
            const video = await fetchChannelVideo(channelId);
            if (video) videos.push(video);
        } catch (error) {
            console.error(`❌ ${channelId}:`, error.message);
        }
    }
    
    return videos;
}

async function fetchChannelVideo(channelId) {
    const videoId = await getLatestVideoId(channelId);
    if (!videoId) return null;

    if (await isVideoExists(videoId)) {
        console.log(`⏭️ Skipping existing video: ${videoId}`);
        return null;
    }

    return await getVideoDetails(videoId);
}

async function getLatestVideoId(channelId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}` +
        `&channelId=${channelId}&part=snippet&order=date` +
        `&maxResults=1&type=video&videoDuration=short` +
        `&fields=items(id(videoId),snippet(title))`
    );

    return response.data.items[0]?.id.videoId;
}

async function isVideoExists(videoId) {
    const doc = await db.collection('videos').doc(videoId).get();
    return doc.exists;
}

async function getVideoDetails(videoId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?key=${YOUTUBE_API_KEY}` +
        `&id=${videoId}&part=snippet,contentDetails,statistics` +
        `&fields=items(snippet(title,description,thumbnails/high,channelId),contentDetails/duration,statistics)`
    );

    const item = response.data.items[0];
    if (!item) return null;

    const duration = parseDuration(item.contentDetails.duration);
    if (duration > 180) return null;

    const channelInfo = await getChannelInfo(item.snippet.channelId);
    
    return {
        videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration,
        durationSeconds: duration,
        creatorUsername: channelInfo.title,
        creatorAvatar: channelInfo.avatar,
        isVerified: channelInfo.isVerified,
        likes: parseInt(item.statistics?.likeCount || 0),
        comments: parseInt(item.statistics?.commentCount || 0),
        isAI: true,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
}

async function getChannelInfo(channelId) {
    if (channelCache.has(channelId)) {
        return channelCache.get(channelId);
    }

    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?key=${YOUTUBE_API_KEY}` +
        `&id=${channelId}&part=snippet,status` +
        `&fields=items(snippet(title,thumbnails/high/url),status)`
    );

    const data = response.data.items[0];
    const result = {
        title: data.snippet.title,
        avatar: data.snippet.thumbnails.high.url,
        isVerified: data.status?.longUploadsStatus === "eligible"
    };

    channelCache.set(channelId, result);
    return result;
}

async function saveVideos(videos) {
    const batch = db.batch();
    
    videos.forEach(video => {
        const ref = db.collection('videos').doc(video.videoId);
        batch.set(ref, video);
    });
    
    await batch.commit();
}

async function logExecution(count) {
    await db.collection('logs').add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        videoCount: count,
        quotaUsed: calculateQuota(count)
    });
}

async function logError(error) {
    await db.collection('errors').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        message: error.message,
        stack: error.stack
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return (parseInt(match?.[1] || 0) * 3600) +
          (parseInt(match?.[2] || 0) * 60) +
          (parseInt(match?.[3] || 0));
}

function calculateQuota(videoCount) {
    return videoCount * 102;
}

fetchVideos();
