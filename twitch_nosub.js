const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

async function searchResults(keyword) {
    try {
        const query = { query: `query { user(login: "${keyword}") { id login displayName profileImageURL(width: 300) } }` };
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
        
        // On nettoie la description pour éviter tout conflit
        const safeDesc = user?.description ? user.description.replace(/["\n\r]/g, " ") : 'Twitch Channel';
        const date = user?.createdAt ? user.createdAt.split('T')[0] : '2024-01-01'; // Format YYYY-MM-DD

        return JSON.stringify([{
            description: safeDesc,
            aliases: 'Twitch',
            airdate: date
        }]);
    } catch (error) { return JSON.stringify([{ description: 'Error', aliases: '', airdate: '' }]); }
}

async function extractEpisodes(login) {
    try {
        const query = {
            query: `query { user(login: "${login}") { videos(first: 20, type: ARCHIVE, sort: TIME) { edges { node { id title publishedAt lengthSeconds previewThumbnailURL(height: 360, width: 640) viewCount } } } } }`
        };

        const responseText = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(query) });
        const json = await responseText.json();
        const edges = json.data?.user?.videos?.edges || [];

        console.log(`[Twitch] Processing ${edges.length} videos...`);

        const episodes = edges.map((edge, index) => {
            const v = edge.node;
            
            // 1. NETTOYAGE TITRE AGRESSIF
            // On enlève les crochets [], les barres |, les guillemets " et les retours à la ligne
            let safeTitle = v.title
                .replace(/[\[\]|"\n\r]/g, " ") // Remplace [ ] | " par espace
                .replace(/\s+/g, " ")       // Enlève les doubles espaces
                .trim();
            
            if (!safeTitle) safeTitle = `VOD #${index + 1}`;

            // 2. DATE (Format YYYY-MM-DD important pour certaines apps)
            let dateIso = "2024-01-01";
            if (v.publishedAt) dateIso = v.publishedAt.split('T')[0];

            // 3. IMAGE
            let img = v.previewThumbnailURL || "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            img = img.replace("{width}", "640").replace("{height}", "360");

            console.log(`[Twitch] Clean Title: ${safeTitle}`);

            return {
                href: v.id,
                number: index + 1,
                season: 1,
                
                // On bombarde l'app avec toutes les clés possibles
                title: safeTitle,
                name: safeTitle,
                episode: safeTitle, // Parfois utilisé
                
                image: img,
                thumbnail: img,
                
                // Date au format ISO standard
                airdate: dateIso,
                date: dateIso,
                
                // Description simple
                description: `${safeTitle} (${Math.floor(v.lengthSeconds/60)} min)`
            };
        });

        return JSON.stringify(episodes);
    } catch (error) {
        console.log('Episodes Error: ' + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(vodId) {
    try {
        let streams = [];
        const tokenQuery = {
            operationName: "PlaybackAccessToken_Template",
            query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }",
            variables: { isLive: false, login: "", isVod: true, vodID: vodId, playerType: "site" }
        };

        const tokenResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery) });
        const tokenJson = await tokenResp.json();
        const tokenData = tokenJson.data?.videoPlaybackAccessToken;

        if (tokenData) {
            const officialUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${tokenData.value}&nauthsig=${tokenData.signature}&allow_source=true&player_backend=mediaplayer`;
            streams.push({ title: "Source (Officiel)", streamUrl: officialUrl, headers: { "Referer": "https://www.twitch.tv/" } });
        }
        
        // Hack Storyboard en secours
        if (streams.length === 0) {
             const sbQuery = { query: `query { video(id: "${vodId}") { seekPreviewsURL } }` };
             const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(sbQuery) });
             const sbJson = await sbResp.json();
             const seekUrl = sbJson.data?.video?.seekPreviewsURL;
             if(seekUrl && seekUrl.includes('storyboards')) {
                 const parts = seekUrl.split('/');
                 const idx = parts.indexOf('storyboards');
                 // Utilisation du domaine et hash
                 const hackedUrl = `https://${parts[2]}/${parts[idx-1]}/chunked/index-dvr.m3u8`;
                 streams.push({ title: "Source (NoSub Bypass)", streamUrl: hackedUrl, headers: { "Referer": "https://www.twitch.tv/" } });
             }
        }
        return JSON.stringify({ streams: streams, subtitles: [] });
    } catch (error) { return JSON.stringify({ streams: [], subtitles: [] }); }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        if (typeof fetchv2 !== 'undefined') return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null, true, 'utf-8');
        return await fetch(url, options);
    } catch(e) { return null; }
}
