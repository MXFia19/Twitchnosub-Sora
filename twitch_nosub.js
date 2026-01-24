const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim().toLowerCase();

        const query = {
            query: `query {
                user(login: "${cleanKeyword}") {
                    id
                    login
                    displayName
                    profileImageURL(width: 300)
                }
            }`
        };

        const responseText = await soraFetch(GQL_URL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(query)
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
    } catch (error) {
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS ---
async function extractDetails(login) {
    try {
        const query = {
            query: `query { user(login: "${login}") { description createdAt } }`
        };

        const responseText = await soraFetch(GQL_URL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(query)
        });
        const json = await responseText.json();
        const user = json.data?.user;

        const results = [{
            description: user?.description ? user.description.replace(/\n/g, " ") : 'Chaine Twitch',
            aliases: 'Twitch',
            airdate: user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Inconnu'
        }];

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([{ description: 'Info indisponible', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES (V3 - SÉPARÉE & ROBUSTE) ---
async function extractEpisodes(login) {
    try {
        const episodes = [];

        // ÉTAPE A : Récupérer le LIVE
        try {
            const queryLive = {
                query: `query { user(login: "${login}") { stream { id title game { name } previewImage { url } } } }`
            };
            const respLive = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryLive) });
            const jsonLive = await respLive.json();
            const currentStream = jsonLive.data?.user?.stream;

            if (currentStream) {
                const gameName = currentStream.game?.name || "Jeu inconnu";
                const liveImg = currentStream.previewImage?.url 
                    ? currentStream.previewImage.url.replace("{width}", "640").replace("{height}", "360")
                    : "https://pngimg.com/uploads/twitch/twitch_PNG13.png";

                episodes.push({
                    href: "LIVE_" + login, 
                    number: 0, 
                    season: 1,
                    title: "🔴 EN DIRECT : " + currentStream.title,
                    name: "🔴 EN DIRECT : " + currentStream.title,
                    image: liveImg,
                    thumbnail: liveImg,
                    duration: "LIVE",
                    description: `Actuellement en direct sur : ${gameName}\n${currentStream.title}`
                });
            }
        } catch (e) {
            console.log("[Twitch] Erreur Live: " + e);
        }

        // ÉTAPE B : Récupérer les VODs
        try {
            const queryVideos = {
                query: `query {
                    user(login: "${login}") {
                        videos(first: 20) {
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

            const respVideos = await soraFetch(GQL_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(queryVideos) });
            const jsonVideos = await respVideos.json();
            const edges = jsonVideos.data?.user?.videos?.edges || [];

            console.log(`[Twitch] ${edges.length} VODs trouvées pour ${login}`);

            edges.forEach((edge, index) => {
                const video = edge.node;
                
                let dateStr = "Inconnu";
                if (video.publishedAt) {
                    dateStr = new Date(video.publishedAt).toLocaleDateString();
                }

                let finalTitle = video.title;
                if (!finalTitle || finalTitle.trim() === "") {
                    finalTitle = `VOD du ${dateStr}`;
                }
                finalTitle = finalTitle.replace(/"/g, "'");

                let imgUrl = video.previewThumbnailURL;
                if (!imgUrl || imgUrl.includes("404_preview")) {
                    imgUrl = "https://pngimg.com/uploads/twitch/twitch_PNG13.png";
                } else {
                    imgUrl = imgUrl.replace("{width}", "640").replace("{height}", "360");
                }

                const minutes = Math.floor(video.lengthSeconds / 60);

                episodes.push({
                    href: video.id,
                    number: index + 1,
                    season: 1, 
                    title: finalTitle,
                    name: finalTitle,
                    image: imgUrl,
                    thumbnail: imgUrl,
                    duration: `${minutes} min`, 
                    description: `${finalTitle}\n${dateStr}`
                });
            });

        } catch (e) {
            console.log("[Twitch] Erreur Videos: " + e);
        }

        return JSON.stringify(episodes);
    } catch (error) {
        console.log('Global Episodes error: ' + error);
        return JSON.stringify([]);
    }
}

// --- 4. STREAM (DIRECT NoSub pour VOD / OFFICIEL pour LIVE) ---
async function extractStreamUrl(vodId) {
    try {
        let streams = [];
        const isLive = vodId.toString().startsWith("LIVE_");
        
        // CAS 1 : LIVE (On est obligé d'utiliser la méthode officielle)
        if (isLive) {
            const login = vodId.replace("LIVE_", "");
            
            const tokenQuery = {
                operationName: "PlaybackAccessToken_Template",
                query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } }",
                variables: { isLive: true, login: login, isVod: false, vodID: "", playerType: "site" }
            };

            const tokenResp = await soraFetch(GQL_URL, {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify(tokenQuery)
            });
            const tokenJson = await tokenResp.json();
            const tokenData = tokenJson.data?.streamPlaybackAccessToken;

            if (tokenData) {
                const safeToken = encodeURIComponent(tokenData.value);
                const safeSig = encodeURIComponent(tokenData.signature);
                const officialUrl = `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`;
                
                streams.push({
                    title: "Source (Live)",
                    streamUrl: officialUrl,
                    headers: { "Referer": "https://www.twitch.tv/" }
                });
            }
        } 
        
        // CAS 2 : VOD (On utilise UNIQUEMENT le hack NoSub)
        else {
            const realVodId = vodId;
            const storyboardQuery = {
                query: `query { video(id: "${realVodId}") { seekPreviewsURL } }`
            };
            
            const sbResp = await soraFetch(GQL_URL, {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify(storyboardQuery)
            });
            const sbJson = await sbResp.json();
            const seekPreviewsURL = sbJson.data?.video?.seekPreviewsURL;

            if (seekPreviewsURL) {
                const urlParts = seekPreviewsURL.split('/');
                const sbIndex = urlParts.indexOf("storyboards");
                
                if (sbIndex > 0) {
                    const domain = urlParts[2];
                    const specialHash = urlParts[sbIndex - 1];
                    // URL directe NoSub
                    const hackedUrl = `https://${domain}/${specialHash}/chunked/index-dvr.m3u8`;
                    
                    streams.push({
                        title: "Source (NoSub)",
                        streamUrl: hackedUrl,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            }
        }

        return JSON.stringify({ streams: streams, subtitles: [] });

    } catch (error) {
        console.log('Stream Error: ' + error);
        return JSON.stringify({ streams: [], subtitles: [] });
    }
}

// --- UTILITAIRE SORA ---
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
