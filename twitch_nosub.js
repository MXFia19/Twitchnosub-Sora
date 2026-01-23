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
        const query = {
            query: `query { user(login: "${keyword}") { id login displayName profileImageURL(width: 300) } }`
        };
        const responseText = await soraFetch(GQL_URL, {
            method: 'POST', headers: HEADERS, body: JSON.stringify(query)
        });
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
        const responseText = await soraFetch(GQL_URL, {
            method: 'POST', headers: HEADERS, body: JSON.stringify(query)
        });
        const json = await responseText.json();
        const user = json.data?.user;
        const desc = user?.description ? user.description.replace(/["\n\r]/g, " ") : 'Twitch Channel';
        
        return JSON.stringify([{
            description: desc,
            aliases: 'Twitch',
            airdate: '2024'
        }]);
    } catch (error) { return JSON.stringify([{ description: 'Error', aliases: '', airdate: '' }]); }
}

async function extractEpisodes(login) {
    try {
        const query = {
            query: `query { user(login: "${login}") { videos(first: 20, type: ARCHIVE, sort: TIME) { edges { node { id title publishedAt lengthSeconds previewThumbnailURL(height: 360, width: 640) viewCount } } } } }`
        };

        const responseText = await soraFetch(GQL_URL, {
            method: 'POST', headers: HEADERS, body: JSON.stringify(query)
        });
        const json = await responseText.json();
        const edges = json.data?.user?.videos?.edges || [];

        console.log(`[Twitch] ${edges.length} VODs found`);

        const episodes = edges.map((edge, index) => {
            const v = edge.node;
            
            // 1. TITRE : On nettoie très agressivement pour test
            // On garde les crochets car c'est utile, mais on vire les guillemets
            let cleanTitle = v.title.replace(/"/g, "'").replace(/\n/g, " ").trim();
            if (!cleanTitle) cleanTitle = `Episode ${index + 1}`;
            
            // 2. IMAGE
            let img = v.previewThumbnailURL || "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            img = img.replace("{width}", "640").replace("{height}", "360");

            // 3. LOG pour debug
            console.log(`[Twitch] Sending: #${index+1} - ${cleanTitle}`);

            return {
                href: v.id,
                number: index + 1,
                season: 1,
                title: cleanTitle,     // Standard
                name: cleanTitle,      // Fallback
                image: img,            // Standard
                thumbnail: img,        // Fallback
                poster: img,           // Fallback
                // ON FORCE LA DURÉE EN STRING (c'est souvent ça qui plante sur iOS)
                duration: String(Math.floor(v.lengthSeconds / 60)) + " min", 
                description: cleanTitle
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

        const tokenResp = await soraFetch(GQL_URL, {
            method: 'POST', headers: HEADERS, body: JSON.stringify(tokenQuery)
        });
        const tokenJson = await tokenResp.json();
        const tokenData = tokenJson.data?.videoPlaybackAccessToken;

        if (tokenData) {
            const officialUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${tokenData.value}&nauthsig=${tokenData.signature}&allow_source=true&player_backend=mediaplayer`;
            streams.push({ title: "Source (Officiel)", streamUrl: officialUrl, headers: { "Referer": "https://www.twitch.tv/" } });
        } else {
             // Fallback Storyboard
             const sbQuery = { query: `query { video(id: "${vodId}") { seekPreviewsURL } }` };
             const sbResp = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(sbQuery) });
             const sbJson = await sbResp.json();
             const seekUrl = sbJson.data?.video?.seekPreviewsURL;
             if(seekUrl && seekUrl.includes('storyboards')) {
                 const parts = seekUrl.split('/');
                 const idx = parts.indexOf('storyboards');
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
