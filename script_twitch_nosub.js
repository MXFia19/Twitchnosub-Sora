// ==========================================
// ⚙️ MODULE SORA -- TWITCH (Live + VODs + Supabase)
// ==========================================

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// ==========================================
// 🗄️ TRACKER SUPABASE
// ==========================================

const SUPABASE_URL = "https://qyeisgowjisqbatrmqta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F68CBjFVPh71U0SdD9BQJg_UJgL9-Fj";

async function sendSupabaseLog(moduleName, actionType, dataPayload) {
    try {
        const payload = { module: moduleName, action: actionType, data: dataPayload };
        const headers = { 
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Prefer": "return=minimal" 
        };
        
        if (typeof fetchv2 !== 'undefined') {
            await fetchv2(`${SUPABASE_URL}/rest/v1/app_logs`, headers, "POST", JSON.stringify(payload));
        } else {
            await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, { method: "POST", headers: headers, body: JSON.stringify(payload) });
        }
    } catch (e) { console.log(`[Tracker] 🚨 Erreur Supabase : ${e.message}`); }
}

// ==========================================
// 🛠️ OUTILS
// ==========================================

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
    return `${day}/${month}/${year}`; 
}

// ==========================================
// ⚙️ LOGIQUE DU MODULE
// ==========================================

// --- 1. RECHERCHE (Live + VODs) ---
async function searchResults(keyword) {
    console.log(`[Twitch] 🔍 Recherche de Live & VODs pour : ${keyword}`);
    try {
        const login = keyword.trim().toLowerCase().replace(/\s+/g, '');
        
        // On demande le stream actuel (s'il existe) ET les VODs
        const query = {
            query: `query {
                user(login: "${login}") {
                    displayName
                    stream {
                        id
                        title
                        viewersCount
                        previewImageURL(width: 640, height: 360)
                    }
                    videos(first: 30, type: ARCHIVE, sort: TIME) {
                        edges {
                            node {
                                id
                                title
                                publishedAt
                                lengthSeconds
                                previewThumbnailURL(height: 360, width: 640)
                            }
                        }
                    }
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;

        if (!user) {
            console.log(`[Twitch] 🚨 Streamer ${login} introuvable.`);
            return JSON.stringify([]);
        }

        const results = [];
        const stream = user.stream;
        const edges = user.videos?.edges || [];

        // 🟢 S'IL EST EN DIRECT, ON L'AJOUTE EN PREMIER
        if (stream) {
            let streamImg = stream.previewImageURL || "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            let viewers = stream.viewersCount ? stream.viewersCount.toLocaleString('fr-FR') : "0";
            
            results.push({
                title: `🔴 [EN DIRECT] ${safeText(stream.title)}`,
                image: streamImg,
                href: `https://www.twitch.tv/${login}` // L'URL d'un Live est la chaîne racine
            });
        }

        // 🟣 ENSUITE ON AJOUTE LES VODS
        edges.forEach((edge) => {
            const video = edge.node;
            const mins = Math.floor(video.lengthSeconds / 60);
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            const durationLabel = hours > 0 ? `${hours}h${remainingMins.toString().padStart(2, '0')}` : `${mins} min`;

            let img = video.previewThumbnailURL;
            if (img && !img.includes("404_preview")) {
                img = img.replace("{width}", "640").replace("{height}", "360");
            } else {
                img = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }

            results.push({
                title: `🟣 [${durationLabel}] ${safeText(video.title) || "VOD Sans Titre"}`,
                image: img,
                href: `https://www.twitch.tv/videos/${video.id}` // L'URL d'une VOD contient /videos/
            });
        });

        sendSupabaseLog("Twitch", "SEARCH", { 
            keyword: keyword, results_count: results.length, top_results: results.slice(0, 3).map(r => r.title)
        });

        return JSON.stringify(results);

    } catch (error) {
        console.log(`[Twitch] 🚨 Erreur Search : ${error}`);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS (Gère le Live ou la VOD) ---
async function extractDetails(url) {
    sendSupabaseLog("Twitch", "DETAILS", { anime_url: url });

    try {
        let query;

        // Cas 1 : C'est une VOD
        if (url.includes('/videos/')) {
            const videoId = url.split('/videos/')[1];
            query = {
                query: `query { video(id: "${videoId}") { description publishedAt viewCount owner { displayName } } }`
            };
            const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
            const json = await responseText.json();
            const video = json.data?.video;

            if (video) {
                const desc = safeText(video.description) || "Aucune description pour cette VOD.";
                const views = video.viewCount ? video.viewCount.toLocaleString('fr-FR') : "0";
                const owner = video.owner?.displayName || "Inconnu";
                return JSON.stringify([{ description: desc, aliases: `Chaîne : ${owner} | Vues : ${views}`, airdate: formatDateISO(video.publishedAt) }]);
            }
        } 
        // Cas 2 : C'est un Live
        else {
            const login = url.split('twitch.tv/')[1].split('/')[0];
            query = {
                query: `query { user(login: "${login}") { description stream { viewersCount createdAt } } }`
            };
            const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
            const json = await responseText.json();
            const user = json.data?.user;

            if (user && user.stream) {
                const desc = safeText(user.description) || "Aucune description.";
                const viewers = user.stream.viewersCount ? user.stream.viewersCount.toLocaleString('fr-FR') : "0";
                return JSON.stringify([{ description: desc, aliases: `EN DIRECT | Spectateurs : ${viewers}`, airdate: formatDateISO(user.stream.createdAt) }]);
            }
        }
        
        return JSON.stringify([{ description: 'Info indisponible', aliases: '', airdate: '' }]);
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur de chargement', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES (Un seul épisode) ---
async function extractEpisodes(url) {
    try {
        let epTitle = url.includes('/videos/') ? "Lancer la VOD" : "Rejoindre le Direct";
        return JSON.stringify([{ href: url, number: 1, season: 1, title: epTitle }]);
    } catch (error) { 
        return JSON.stringify([]); 
    }
}

// --- 4. STREAM (Gère l'extraction Live & VOD) ---
async function extractStreamUrl(url) {
    console.log(`[Lecteur Twitch] 🎬 Demande de flux pour : ${url}`);
    try {
        let streams = [];
        let isVod = url.includes("/videos/");
        let extractedNames = [];
        let failedLinks = [];

        // 🟣 LECTURE D'UNE VOD
        if (isVod) {
            const videoId = url.split('/videos/')[1];
            
            // Tentative 1 : NoSub (Sans pub)
            try {
                const sbQuery = { query: `query { video(id: "${videoId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(sbQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({ title: "VOD (Sans Pub)", streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`, headers: { "Referer": "https://www.twitch.tv/" } });
                        extractedNames.push("VOD Sans Pub");
                    }
                }
            } catch (e) {}

            // Tentative 2 : Officiel
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
                    streams.push({ title: "VOD (Officiel)", streamUrl: `https://usher.ttvnw.net/vod/${videoId}.m3u8?nauth=${safeToken}&nauthsig=${safeSig}&allow_source=true&player_backend=mediaplayer`, headers: { "Referer": "https://www.twitch.tv/" } });
                    extractedNames.push("VOD Officiel");
                } else {
                    failedLinks.push({ server_name: "Twitch VOD Token", url: url });
                }
            } catch (e) {}
        } 
        
        // 🔴 LECTURE D'UN LIVE
        else {
            const login = url.split('twitch.tv/')[1].split('/')[0];
            try {
                const tokenQuery = {
                    operationName: "PlaybackAccessToken_Template",
                    query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } }",
                    variables: { isLive: true, login: login, isVod: false, vodID: "", playerType: "site" }
                };
                const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
                const tokenJson = await tokenResp.json();
                const tokenData = tokenJson.data?.streamPlaybackAccessToken;
                
                if (tokenData) {
                    const safeToken = encodeURIComponent(tokenData.value);
                    const safeSig = encodeURIComponent(tokenData.signature);
                    streams.push({ title: "Live (Qualité Source)", streamUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?allow_source=true&sig=${safeSig}&token=${safeToken}&player_backend=mediaplayer`, headers: { "Referer": "https://www.twitch.tv/" } });
                    extractedNames.push("Live Officiel");
                } else {
                    failedLinks.push({ server_name: "Twitch Live Token", url: url });
                }
            } catch (e) {}
        }

        // 📡 Log Supabase
        sendSupabaseLog("Twitch", "PLAYER", { anime_url: url, season_number: "1", ep_number: "1", streams_found: streams.length, servers: extractedNames });
        if (failedLinks.length > 0) {
            sendSupabaseLog("Twitch", "UNSUPPORTED_HOSTS", { anime_url: url, season_number: "1", ep_number: "1", failed_count: failedLinks.length, failed_links: failedLinks });
        }

        return JSON.stringify(streams.length > 0 ? { type: "servers", streams: streams } : { type: "none" });

    } catch (error) { 
        return JSON.stringify({ type: "none" }); 
    }
}

// --- UTILS SORA ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try { return await fetch(url, options); } catch(error) { return null; }
    }
}
