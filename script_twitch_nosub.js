const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- TOOLS ---
function safeText(str) {
    if (!str) return "";
    return str.replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
}

function formatDateISO(isoString) {
    if (!isoString) return "0000-00-00";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "0000-00-00";
    
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${day}/${month}/${year}`; // Format FR plus joli
}

// --- 1. SEARCH (Cherche le Streamer) ---
async function searchResults(keyword) {
    console.log(`[Twitch] Recherche du streamer : ${keyword}`);
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        
        // On demande uniquement les infos du profil
        const query = {
            query: `query {
                user(login: "${cleanKeyword}") {
                    login
                    displayName
                    profileImageURL(width: 300)
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;

        if (!user) {
            console.log(`[Twitch] Streamer ${cleanKeyword} introuvable.`);
            return JSON.stringify([]);
        }

        // On renvoie le streamer comme un "Show" avec sa photo
        return JSON.stringify([{
            title: user.displayName,
            image: user.profileImageURL || "https://pngimg.com/uploads/twitch/twitch_PNG13.png",
            href: `https://www.twitch.tv/${user.login}`
        }]);

    } catch (error) {
        console.log(`[Twitch] Erreur Search : ${error}`);
        return JSON.stringify([]);
    }
}

// --- 2. DETAILS (Bio du Streamer) ---
async function extractDetails(url) {
    try {
        // On extrait le pseudo depuis l'URL (ex: https://www.twitch.tv/zerator)
        const login = url.split('twitch.tv/')[1].split('/')[0];
        
        const query = {
            query: `query {
                user(login: "${login}") {
                    description
                    createdAt
                    followers { totalCount }
                }
            }`
        };
        
        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;

        if (user) {
            const desc = safeText(user.description) || "Aucune biographie disponible pour cette chaîne.";
            const followers = user.followers?.totalCount ? user.followers.totalCount.toLocaleString('fr-FR') : "0";
            
            return JSON.stringify([{
                description: desc,
                aliases: `Followers : ${followers}`,
                airdate: `Créé le : ${formatDateISO(user.createdAt)}`
            }]);
        }
        
        return JSON.stringify([{ description: 'Info indisponible', aliases: '', airdate: '' }]);
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur de chargement', aliases: '', airdate: '' }]);
    }
}

// --- 3. EPISODES (Les VODs du Streamer) ---
async function extractEpisodes(url) {
    try {
        const login = url.split('twitch.tv/')[1].split('/')[0];
        
        // On demande les 30 dernières VODs
        const query = {
            query: `query {
                user(login: "${login}") {
                    videos(first: 30, type: ARCHIVE, sort: TIME) {
                        edges {
                            node {
                                id
                                title
                                publishedAt
                                lengthSeconds
                            }
                        }
                    }
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        let edges = json.data?.user?.videos?.edges || [];

        let episodes = [];
        
        // On transforme chaque VOD en épisode
        edges.forEach((edge, index) => {
            const video = edge.node;
            const dateStr = formatDateISO(video.publishedAt);
            const mins = Math.floor(video.lengthSeconds / 60);
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            const duration = hours > 0 ? `${hours}h${remainingMins.toString().padStart(2, '0')}` : `${mins} min`;

            episodes.push({
                href: `https://www.twitch.tv/videos/${video.id}`,
                number: index + 1, // L'épisode 1 est la VOD la plus récente
                title: `[${dateStr} - ${duration}] ${safeText(video.title)}`
            });
        });

        return JSON.stringify(episodes);

    } catch (error) { 
        console.log(`[Twitch] Erreur Episodes : ${error}`);
        return JSON.stringify([]); 
    }
}

// --- 4. STREAM (Inchangé, gère la vidéo) ---
async function extractStreamUrl(url) {
    try {
        let streams = [];
        let videoId = "";
        
        if (url.includes("/videos/")) {
            const match = url.match(/\/videos\/(\d+)/);
            if (match) videoId = match[1];
        }

        if (videoId) {
            // 1. NoSub (Version sans pub si dispo)
            try {
                const storyboardQuery = { query: `query { video(id: "${videoId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "VOD (NoSub - Sans Pub)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}

            // 2. Officiel
            try {
                const tokenQuery = {
                    operationName: "PlaybackAccessToken_Template",
                    query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }",
                    variables: { isLive: false, login: "", isVod: true, vodID: videoId, playerType: "site" }
                };
                const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
                const tokenJson = await tokenResp.json();
                const tokenData = tokenJson.data?.videoPlaybackAccessToken;
                if (tokenData) {
                    const safeToken = encodeURIComponent(tokenData.value);
                    const safeSig = encodeURIComponent(tokenData.signature);
                    streams.push({
                        title: "VOD (Officiel)",
                        streamUrl: `https://usher.ttvnw.net/vod/${videoId}.m3u8?nauth=${safeToken}&nauthsig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        }

        return JSON.stringify({ streams: streams, subtitles: [] });

    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

// --- UTILS SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(
                url,
                options.headers ?? {},
                options.method ?? 'GET',
                options.body ?? null,
                true,
                options.encoding ?? 'utf-8'
            );
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
