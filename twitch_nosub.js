const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// Fonction de nettoyage (Garde lettres, chiffres, accents et ponctuation simple)
function safeString(str) {
    if (!str) return "";
    return str.replace(/[^a-zA-Z0-9àâçéèêëîïôûùüÿñæœ .,!?'\-:()]/g, "").trim();
}

async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim().toLowerCase();
        const query = { query: `query { user(login: "${cleanKeyword}") { id, login, displayName, profileImageURL(width: 300) } }` };
        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;
        const results = [];
        if (user) {
            results.push({
                title: user.displayName,
                image: user.profileImageURL,
                href: user.login
            });
        }
        return JSON.stringify(results);
    } catch (error) { return JSON.stringify([]); }
}

async function extractDetails(login) {
    try {
        const query = { query: `query { user(login: "${login}") { description createdAt } }` };
        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const user = json.data?.user;
        
        const safeDesc = safeString(user?.description || 'Chaine Twitch');

        return JSON.stringify([{
            description: safeDesc,
            aliases: 'Twitch',
            airdate: user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Inconnu'
        }]);
    } catch (error) { return JSON.stringify([{ description: 'Info indisponible', aliases: '', airdate: '' }]); }
}

async function extractEpisodes(login) {
    try {
        const episodes = [];

        // --- LIVE ---
        try {
            const queryLive = { query: `query { user(login: "${login}") { stream { id title game { name } previewImage { url } } } }` };
            const respLive = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryLive) });
            const jsonLive = await respLive.json();
            const currentStream = jsonLive.data?.user?.stream;

            if (currentStream) {
                const safeGame = safeString(currentStream.game?.name || "Jeu inconnu");
                const safeTitle = safeString(currentStream.title || "Live");
                
                let liveImg = "https://pngimg.com/uploads/twitch/twitch_PNG13.png";
                if (currentStream.previewImage?.url) {
                    liveImg = currentStream.previewImage.url.replace("{width}", "1280").replace("{height}", "720");
                }

                episodes.push({
                    href: "LIVE_" + login,
                    number: 0,
                    season: 1,
                    title: "EN DIRECT : " + safeGame,
                    name: "EN DIRECT : " + safeGame,
                    image: liveImg,
                    thumbnail: liveImg,
                    duration: "LIVE",
                    description: "Titre du live : " + safeTitle
                });
            }
        } catch (e) {}

        // --- VODS ---
        try {
            const queryVideos = { query: `query { user(login: "${login}") { videos(first: 20) { edges { node { id, title, publishedAt, lengthSeconds, previewThumbnailURL(height: 360, width: 640) } } } } }` };
            const respVideos = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryVideos) });
            const jsonVideos = await respVideos.json();
            const edges = jsonVideos.data?.user?.videos?.edges || [];

            edges.forEach((edge, index) => {
                const video = edge.node;
                
                let dateStr = "Inconnu";
                if (video.publishedAt) {
                    let d = new Date(video.publishedAt);
                    dateStr = d.toLocaleDateString(); 
                }

                const realTitle = safeString(video.title || "");
                const displayTitle = `VOD du ${dateStr}`; 

                let imgUrl = video.previewThumbnailURL;
                if (!imgUrl || imgUrl.includes("404_preview")) {
                    imgUrl = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
                } else {
                    imgUrl = imgUrl.replace("{width}", "1280").replace("{height}", "720");
                }

                const minutes = Math.floor(video.lengthSeconds / 60);

                episodes.push({
                    href: video.id,
                    number: index + 1,
                    season: 1,
                    title: displayTitle,
                    name: displayTitle,
                    image: imgUrl,
                    thumbnail: imgUrl,
                    duration: `${minutes} min`,
                    description: realTitle
                });
            });
        } catch (e) {}

        return JSON.stringify(episodes);
    } catch (error) { return JSON.stringify([]); }
}

async function extractStreamUrl(vodId) {
    try {
        let streams = [];
        const isLive = vodId.toString().startsWith("LIVE_");
        let login = "";
        let realVodId = vodId;

        if (isLive) login = vodId.replace("LIVE_", "");
        else realVodId = vodId;

        if (isLive) {
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
                    streams.push({
                        title: "Live (Officiel)",
                        streamUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            } catch (e) {}
        } else {
            try {
                const storyboardQuery = { query: `query { video(id: "${realVodId}") { seekPreviewsURL } }` };
                const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(storyboardQuery) });
                const sbJson = await sbResp.json();
                const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;
                if (seekPreviewsURL) {
                    const urlParts = seekPreviewsURL.split('/storyboards/');
                    if (urlParts.length > 0) {
                        streams.push({
                            title: "Lecture Directe (NoSub)",
                            streamUrl: `${urlParts[0]}/chunked/index-dvr.m3u8`,
                            headers: { "Referer": "https://www.twitch.tv/" }
                        });
                    }
                }
            } catch (e) {}
        }
        return JSON.stringify({ streams: streams, subtitles: [] });
    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        if (typeof fetchv2 !== 'undefined') return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, options.encoding ?? 'utf-8');
        else return await fetch(url, options);
    } catch (e) { try { return await fetch(url, options); } catch (error) { return null; } }
}
