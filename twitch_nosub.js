const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// Image générique pour toutes les vidéos (Logo Twitch)
const GENERIC_IMAGE = "https://pngimg.com/uploads/twitch/twitch_PNG13.png";

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
    // On ne récupère plus la description dynamique pour éviter les bugs
    return JSON.stringify([{
        description: 'Chaine Twitch',
        aliases: 'Twitch',
        airdate: 'Inconnu'
    }]);
}

async function extractEpisodes(login) {
    try {
        const episodes = [];

        // --- LIVE ---
        try {
            const queryLive = { query: `query { user(login: "${login}") { stream { id } } }` };
            const respLive = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryLive) });
            const jsonLive = await respLive.json();
            
            if (jsonLive.data?.user?.stream) {
                episodes.push({
                    href: "LIVE_" + login,
                    number: 0,
                    season: 1,
                    title: "LIVE EN COURS",
                    name: "LIVE EN COURS",
                    image: GENERIC_IMAGE,
                    thumbnail: GENERIC_IMAGE,
                    duration: "LIVE",
                    description: "Diffusion en direct"
                });
            }
        } catch (e) {}

        // --- VODS ---
        try {
            // On ne demande plus les titres ni les images à Twitch, juste l'ID et la Date
            const queryVideos = { query: `query { user(login: "${login}") { videos(first: 20) { edges { node { id, publishedAt, lengthSeconds } } } } }` };
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

                const simpleTitle = `VOD du ${dateStr}`;
                const minutes = Math.floor(video.lengthSeconds / 60);

                episodes.push({
                    href: video.id,
                    number: index + 1,
                    season: 1,
                    title: simpleTitle,
                    name: simpleTitle,
                    image: GENERIC_IMAGE, // Image fixe forcée
                    thumbnail: GENERIC_IMAGE,
                    duration: `${minutes} min`,
                    description: "Rediffusion Twitch"
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
            // Lecture NoSub Uniquement
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
