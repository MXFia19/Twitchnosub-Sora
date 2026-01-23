const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// --- 1. RECHERCHE (Search) ---
async function searchResults(keyword) {
    try {
        // On cherche un streamer par son pseudo exact ou partiel
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
                href: user.login // On utilise le login comme identifiant unique
            });
        } else {
             // Si pas de résultat exact, on renvoie une liste vide (ou on pourrait implémenter une recherche searchChannels)
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log('Search error: ' + error);
        return JSON.stringify([]);
    }
}

// --- 2. DÉTAILS (Details) ---
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
            description: user?.description || 'Chaine Twitch',
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
        // On récupère les 20 dernières VODs avec une image HD
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
            
            // Formatage de la durée
            const minutes = Math.floor(video.lengthSeconds / 60);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            const timeStr = hours > 0 ? `${hours}h${mins}` : `${mins}min`;
            
            // Formatage date
            const dateStr = new Date(video.publishedAt).toLocaleDateString();

            // Gestion image (Fallback si vide)
            let imgUrl = video.previewThumbnailURL;
            if(!imgUrl || imgUrl.includes('404_preview')) {
                 imgUrl = "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";
            }

            return {
                href: video.id, // ID de la VOD
                number: index + 1, // Numéro 1, 2, 3... pour l'ordre
                title: video.title, // Vrai titre
                image: imgUrl, // Vraie image
                description: `📅 ${dateStr} • ⏳ ${timeStr} • 👀 ${video.viewCount} vues`
            };
        });

        return JSON.stringify(episodes);
    } catch (error) {
        console.log('Episodes error: ' + error);
        return JSON.stringify([]);
    }
}

// --- 4. STREAM (Le Hack NoSub) ---
async function extractStreamUrl(vodId) {
    try {
        let streams = [];

        // --- METHODE A : OFFICIEL ---
        // On essaie d'abord poliment avec l'API Twitch
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
            
            // On vérifie si le lien fonctionne (Status 200)
            const check = await soraFetch(officialUrl);
            if (check && check.status === 200) {
                streams.push({
                    title: "Source (Officiel)",
                    streamUrl: officialUrl, // Sora utilise souvent streamUrl ou file
                    headers: { "Referer": "https://www.twitch.tv/" }
                });
            }
        }

        // --- METHODE B : HACK STORYBOARD (Si officiel échoue) ---
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
                // Analyse de l'URL pour trouver le Hash secret
                // URL Type: https://[DOMAINE]/.../storyboards/[HASH]_storyboard_1.jpg
                const urlParts = seekPreviewsURL.split('/');
                const sbIndex = urlParts.indexOf("storyboards");
                
                if (sbIndex > 0) {
                    const domain = urlParts[2]; // ex: dqrpb9wgowsf5.cloudfront.net
                    const specialHash = urlParts[sbIndex - 1]; // Le dossier juste avant "storyboards"
                    
                    // On reconstruit le lien .m3u8 manuellement
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
        console.log('Stream error: ' + error);
        return JSON.stringify({ streams: [], subtitles: [] });
    }
}

// --- FONCTION UTILITAIRE SORA (Obligatoire) ---
// Cette fonction permet d'utiliser le fetch natif de l'app si dispo, ou le fetch standard sinon
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
