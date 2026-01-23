const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';

const HEADERS = {
    'Client-ID': CLIENT_ID,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.twitch.tv/',
    'Origin': 'https://www.twitch.tv',
    'Content-Type': 'application/json'
};

// 1. RECHERCHE : On cherche une chaîne par son pseudo
async function searchResults(keyword) {
    try {
        const query = {
            query: `query {
                user(login: "${keyword}") {
                    id
                    login
                    displayName
                    profileImageURL(width: 300)
                    description
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
                href: user.login // On passe le login comme identifiant pour la suite
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log('Search error: ' + error);
        return JSON.stringify([]);
    }
}

// 2. DÉTAILS : Infos de la chaîne
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
            description: user?.description || 'Aucune description',
            aliases: 'Twitch Channel',
            airdate: `Créé le: ${user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Inconnu'}`
        }];

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([{ description: 'Erreur', aliases: '', airdate: '' }]);
    }
}

// 3. ÉPISODES : Liste des VODs (Archives)
async function extractEpisodes(login) {
    try {
        // On demande une image plus grande (640x360) pour un meilleur rendu
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
            
            // Calculs de formatage
            const duration = Math.floor(video.lengthSeconds / 60);
            let dateStr = "Date inconnue";
            try {
                dateStr = new Date(video.publishedAt).toLocaleDateString();
            } catch(e) {}

            // IMAGE : On s'assure d'avoir une URL valide
            // Parfois Twitch renvoie une URL sans l'image générée, on met un placeholder au cas où
            const imgUrl = video.previewThumbnailURL || "https://vod-secure.twitch.tv/_404/404_preview-640x360.jpg";

            return {
                href: video.id,
                
                // --- NUMÉROTATION ---
                number: index + 1, // 1, 2, 3... (Indispensable pour l'ordre)
                season: 1,         // On force la saison 1 pour grouper

                // --- TITRES (On met les deux pour être sûr) ---
                title: video.title,
                name: video.title, // Certaines apps cherchent "name" au lieu de "title"

                // --- IMAGES (On met tous les formats possibles) ---
                image: imgUrl,
                thumbnail: imgUrl,
                poster: imgUrl,

                // --- DESCRIPTION ---
                description: `📺 ${video.title}\n📅 ${dateStr} • ⏱ ${duration} min`
            };
        });

        return JSON.stringify(episodes);
    } catch (error) {
        console.log('Episodes error: ' + error);
        return JSON.stringify([]);
    }
}


// 4. STREAM : La logique NoSub (Token -> Officiel ou Hack Storyboard)
async function extractStreamUrl(vodId) {
    try {
        let streams = [];

        // ÉTAPE A : Tenter d'avoir le lien officiel (si pas sub-only ou si bug Twitch)
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
            
            // On teste si le lien officiel fonctionne (Code 200)
            const check = await soraFetch(officialUrl);
            if (check && check.status === 200) {
                streams.push({
                    title: "Source (Officiel)",
                    streamUrl: officialUrl,
                    headers: { "Referer": "https://www.twitch.tv/" }
                });
            }
        }

        // ÉTAPE B : Si on n'a pas de flux officiel (probablement Sub-Only), on lance le Hack
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
                // Logique du Hack Storyboard
                // URL type: https://.../storyboards/HASH_storyboard_1.jpg
                const urlParts = seekPreviewsURL.split('/');
                const sbIndex = urlParts.indexOf("storyboards");
                
                if (sbIndex > 0) {
                    const domain = urlParts[2]; // ex: dqrpb9wgowsf5.cloudfront.net
                    const specialHash = urlParts[sbIndex - 1];
                    
                    // On reconstruit le lien "chunked" (Qualité Source)
                    const hackedUrl = `https://${domain}/${specialHash}/chunked/index-dvr.m3u8`;
                    
                    streams.push({
                        title: "Source (NoSub Hack)",
                        streamUrl: hackedUrl,
                        headers: { "Referer": "https://www.twitch.tv/" }
                    });
                }
            }
        }

        return JSON.stringify({ streams: streams, subtitles: "" });

    } catch (error) {
        console.log('Stream error: ' + error);
        return JSON.stringify({ streams: [], subtitles: "" });
    }
}

// --- FONCTION UTILITAIRE SORA (Obligatoire) ---
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        // Sora expose fetchv2 globalement
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? 'GET',
            options.body ?? null,
            true,
            options.encoding ?? 'utf-8'
        );
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
