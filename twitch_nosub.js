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

// --- 3. ÉPISODES (AVEC LIVE) ---
async function extractEpisodes(login) {
    try {
        const query = {
            query: `query {
                user(login: "${login}") {
                    stream {
                        id
                        title
                        game { name }
                        previewImage { url }
                    }
                    videos(first: 20, type: ARCHIVE, sort: TIME) {
                        edges {
                            node {
                                id
                                title
                                publishedAt
                                lengthSeconds
                                previewThumbnailURL(height: 360, width: 640)
                                viewCount
                            }
                        }
                    }
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
        const edges = user?.videos?.edges || [];
        const currentStream = user?.stream; 

        console.log(`[Twitch] ${edges.length} VODs trouvées pour ${login}`);

        const episodes = edges.map((edge, index) => {
            const video = edge.node;
            
            let dateStr = "Inconnu";
            if (video.publishedAt) {
                dateStr = new Date(video.publishedAt).toLocaleDateString();
            }

            let finalTitle = video.title || `VOD du ${dateStr}`;
            finalTitle = finalTitle.replace(/"/g, "'");

            let imgUrl = video.previewThumbnailURL;
            if (!imgUrl || imgUrl.includes("404_preview")) {
                imgUrl = "https://pngimg.com/uploads/twitch/twitch_PNG13.png";
            } else {
                imgUrl = imgUrl.replace("{width}", "640").replace("{height}", "360");
            }

            const minutes = Math.floor(video.lengthSeconds / 60);

            return {
                href: video.id,
                number: index + 1,
                season: 1, 
                title: finalTitle,
                name: finalTitle,
                image: imgUrl,
                thumbnail: imgUrl,
                duration: `${minutes} min`, 
                description: `${finalTitle}\n${dateStr}`
            };
        });

        if (currentStream) {
            const gameName = currentStream.game?.name || "Jeu inconnu";
            const liveImg = currentStream.previewImage?.url 
                ? currentStream.previewImage.url.replace("{width}", "640").replace("{height}", "360")
                : "https://pngimg.com/uploads/twitch/twitch_PNG13.png";

            const liveEpisode = {
                href: "LIVE_" + login, 
                number: 0, 
                season: 1,
                title: "🔴 EN DIRECT : " + currentStream.title,
                name: "🔴 EN DIRECT : " + currentStream.title,
                image: liveImg,
                thumbnail: liveImg,
                duration: "LIVE",
                description: `Actuellement en direct sur : ${gameName}\n${currentStream.title}`
            };

            episodes.unshift(liveEpisode);
        }

        return JSON.stringify(episodes);
    } catch (error) {
        console.log('Episodes error: ' + error);
        return JSON.stringify([]);
    }
}

// --- 4. STREAM (COMPATIBLE LIVE & VOD) ---
async function extractStreamUrl(vodId) {
    try {
        let streams = [];
        
        const isLive = vodId.toString().startsWith("LIVE_");
        
        let login = "";
        let realVodId = vodId;

        if (isLive) {
            login = vodId.replace("LIVE_", "");
        } else {
            realVodId = vodId;
        }

        const tokenQuery = {
            operationName: "PlaybackAccessToken_Template",
            query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }",
            variables: { 
                isLive: isLive, 
                login: isLive ? login : "", 
                isVod: !isLive, 
                vodID: isLive ? "" : realVodId, 
                playerType: "site" 
            }
        };

        const tokenResp = await soraFetch(GQL_URL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(tokenQuery)
        });
        const tokenJson = await tokenResp.json();
        
        let tokenData;
        if (isLive) {
            tokenData = tokenJson.data?.streamPlaybackAccessToken;
        } else {
            tokenData = tokenJson.data?.videoPlaybackAccessToken;
        }

        if (tokenData) {
            const safeToken = encodeURIComponent(tokenData.value);
            const safeSig = encodeURIComponent(tokenData.signature);

            let officialUrl = "";
            
            if (isLive) {
                officialUrl = `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?token=${safeToken}&sig=${safeSig}&allow_source=true&player_backend=mediaplayer`;
            } else {
                officialUrl = `https://usher.ttvnw.net/vod/${realVodId}.m3u8?nauth=${safeToken}&nauthsig=${safeSig}&allow_source=true&player_backend=mediaplayer`;
            }
            
            streams.push({
                title: isLive ? "Source (Live)" : "Source (Officiel)",
                streamUrl: officialUrl,
                headers: { "Referer": "https://www.twitch.tv/" }
            });
        }

        if (streams.length === 0 && !isLive) {
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
                    const hackedUrl = `https://${domain}/${specialHash}/chunked/index-dvr.m3u8`;
                    
                    streams.push({
                        title: "Source (Backup)",
                        streamUrl: hackedUrl,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            }
        }

        const results = {
            streams: streams,
            subtitles: []
        };

        return JSON.stringify(results);

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
