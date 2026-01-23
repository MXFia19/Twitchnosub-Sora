const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- UTILITAIRE : Nettoyer les chaines pour éviter les erreurs JSON ---
function cleanString(str) {
    if (!str) return "";
    // Remplace les guillemets doubles par des simples pour ne pas casser le JSON.stringify
    return str.replace(/"/g, "'").replace(/\n/g, " ").trim();
}

// --- 1. RECHERCHE ---
async function searchResults(keyword) {
    try {
        const query = {
            query: `query {
                user(login: "${keyword}") {
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
            description: cleanString(user?.description) || 'Chaine Twitch',
            aliases: 'Twitch',
            airdate: user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Inconnu'
        }];

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur chargement', aliases: '', airdate: '' }]);
    }
}

// --- 3. ÉPISODES (VODs) ---
async function extractEpisodes(login) {
    try {
        // On demande du 640x360 pour avoir de la HD
        const query = {
            query: `query {
                user(login: "${login}") {
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
        const edges = json.data?.user?.videos?.edges || [];

        const episodes = edges.map((edge, index) => {
            const video = edge.node;
            
            // Calcul durée
            const minutes = Math.floor(video.lengthSeconds / 60);
            
            // Gestion Image : Twitch renvoie parfois des templates ou des 404
            let imgUrl = video.previewThumbnailURL;
            if (!imgUrl || imgUrl.includes("404_preview")) {
                // Placeholder générique si pas d'image
                imgUrl = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }
            // Force le remplacement des templates si présents
            imgUrl = imgUrl.replace("{width}", "640").replace("{height}", "360");

            const safeTitle = cleanString(video.title);

            return {
                href: video.id,
                number: index + 1,
                
                // On met tous les champs possibles pour que Sora trouve le titre
                title: safeTitle,
                name: safeTitle,
                
                // On met tous les champs possibles pour l'image
                image: imgUrl,
                img: imgUrl,
                thumbnail: imgUrl,
                
                // Description courte sans saut de ligne
                description: `${minutes} min - ${video.viewCount} vues`
            };
        });

        return JSON.stringify(episodes);
    } catch (error) {
        // En cas d'erreur, on renvoie une liste vide valide pour ne pas crasher l'app
        return JSON.stringify([]);
    }
}

// --- 4. STREAM (Hack NoSub) ---
async function extractStreamUrl(vodId) {
    try {
        let streams = [];

        // Etape A : Token Officiel
        const tokenQuery = {
            operationName: "PlaybackAccessToken_Template",
            query: "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }",
            variables: { isLive: false, login: "", isVod: true, vodID: vodId, playerType: "site" }
        };

        const tokenResp = await soraFetch(GQL_URL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(tokenQuery)
        });
        const tokenJson = await tokenResp.json();
        const tokenData = tokenJson.data?.videoPlaybackAccessToken;

        if (tokenData) {
            const officialUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?nauth=${tokenData.value}&nauthsig=${tokenData.signature}&allow_source=true&player_backend=mediaplayer`;
            
            const check = await soraFetch(officialUrl);
            if (check && check.status === 200) {
                streams.push({
                    title: "Source (Officiel)",
                    streamUrl: officialUrl,
                    headers: { "Referer": "https://www.twitch.tv/" }
                });
            }
        }

        // Etape B : Hack Storyboard (Si officiel échoue)
        if (streams.length === 0) {
            const storyboardQuery = {
                query: `query { video(id: "${vodId}") { seekPreviewsURL } }`
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
                        title: "Source (NoSub Bypass)",
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
        return JSON.stringify({ streams: [], subtitles: [] });
    }
}

// --- FONCTION SORA OBLIGATOIRE ---
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
