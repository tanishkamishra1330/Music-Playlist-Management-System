# Sonora — Music Playlist Management System

Sonora is a local, dark-themed web music player backed by the project's
hand-written C++ doubly linked list. The browser provides the player interface,
HTML5 Audio playback for local uploads, and optional Spotify catalog search and
playback through Spotify's Web Playback SDK. The C++ server owns all playlist
metadata and operations. Uploaded local audio is saved under `uploads/`;
Spotify audio is never downloaded, stored, or served by Sonora.

The linked list remains the source of truth: the server does not keep a second
playlist in a vector, database, or other container. The only array used by the
playlist is the existing temporary array of node pointers for Fisher-Yates
shuffling; after a shuffle, the nodes are relinked and the list is still the
playlist.

## Project structure

```text
Dsa Project/
├── main.cpp                     # SongNode, Playlist, console UI, and HTTP server
├── index.html                   # Responsive player interface
├── style.css                    # Original Sonora dark theme
├── script.js                    # REST client and local/Spotify playback controls
├── spotify.js                   # PKCE login, catalog search, Spotify Web Playback
├── uploads/
│   └── .gitkeep                 # Audio files uploaded by the player go here
├── third_party/
│   ├── httplib.h                # cpp-httplib 0.18.3 (MIT)
│   └── LICENSE.cpp-httplib      # Upstream MIT license
├── sample_test_cases.txt        # Console DSA/manual test scenarios
├── tests/
│   └── test_spotify_api.py      # Linked-list Spotify metadata/API integration test
└── README.md
```

## Features

- Add and remove tracks with title, artist, duration, and uploaded audio.
- Browse and search titles/artists, play a selected song, and show duration.
- HTML5 play/pause, previous/next, shuffle, repeat off/all/one, progress seek,
  and volume.
- Sort by title, reverse, clear, and display the current track.
- Audio file streaming from the local C++ server.
- Optional Spotify Authorization Code with PKCE, track/artist/album catalog
  search, linked-list insertion, and Web Playback SDK controls.
- Clear local-versus-Spotify track labels; Spotify nodes retain Spotify IDs,
  URIs, album, and artwork metadata but no audio path.
- Responsive desktop/mobile layout; Sonora branding is local, while Spotify
  catalog artwork is loaded from Spotify.
- Input validation, JSON errors, localhost-only binding, upload type/size checks,
  and safe generated upload names.

Audio playback is simulated only in the original console mode. The web mode
plays uploaded files with HTML5 Audio and Spotify catalog tracks through
Spotify's supported Web Playback SDK. Spotify playback requires Premium and a
Spotify account authorized for the app.

## Architecture and data structures

`SongNode` stores ID, title, artist, duration, a source type and `next` and
`previous` pointers. Local nodes also store an uploaded audio path; Spotify
nodes store the Spotify track ID/URI, album, and artwork URL instead.
`Playlist` owns those nodes and keeps `head`, `tail`, `current`, count, and
repeat mode. The HTTP handlers call methods on this same `Playlist`;
serialization walks the list directly. A mutex protects accesses because
cpp-httplib handles requests on worker threads.

Insertion, deletion, searching, navigation, sorting, reversing, shuffling, and
clearing all run in C++. Spotify search results are added through the C++ API
and appended to this same linked list. Browser arrays are only temporary API
response/rendering data; they are not a second playlist store. When the current
track is removed, the existing `removeNode` pointer updates select the
successor, or the predecessor when the removed song was last. Clearing or
deleting a local song also removes its associated uploaded file.

The original menu-driven console app is preserved. Compile without
`PLAYLIST_WEB_SERVER` to run it; add the macro to `main.cpp`'s compile command
to run the web server.

## REST API

All responses use `application/json` for API routes. Errors have the form
`{"error":"..."}`. Uploads use `multipart/form-data` because a binary audio
file cannot be safely carried as ordinary JSON; the response and every other
API operation are JSON. The UI and API share the same origin, so CORS is not
needed. The server binds to `127.0.0.1` only.

| Method | Endpoint | Request | Result |
|---|---|---|---|
| GET | `/api/playlist` | — | `{name,count,currentId,repeat,songs}` |
| GET | `/api/current` | — | `{song}`; song is `null` when empty |
| GET | `/api/spotify/config` | — | `{configured,clientIdDetected,clientId,redirectUri}`; no secret is returned |
| POST | `/api/spotify/config` | JSON `{ "clientId": "..." }` | Save the public Client ID locally and configure Spotify immediately |
| POST | `/api/songs` | multipart fields `title`, `artist`, `duration` (seconds), `audio` | `201 {song}` |
| POST | `/api/songs/spotify` | multipart Spotify metadata fields | `201 {song}`; duplicate Spotify IDs return `409` |
| DELETE | `/api/songs/` | JSON `{ "id": 1 }` | `{deleted,playlist}` |
| POST | `/api/play/` | JSON `{ "id": 1 }` | `{song}`; selects by ID |
| POST | `/api/next` | — | `{song}`; `409` at the last song unless repeat-all |
| POST | `/api/previous` | — | `{song}`; `409` at the first song unless repeat-all |
| POST | `/api/shuffle` | — | Updated playlist; Fisher-Yates relinks the nodes |
| POST | `/api/reverse` | — | Updated playlist |
| POST | `/api/sort` | — | Updated playlist; case-insensitive title sort |
| POST | `/api/repeat` | JSON `{ "mode": "off" \| "one" \| "all" }` | Updated playlist |
| DELETE | `/api/playlist` | — | Empty playlist |

Supported upload extensions are MP3, WAV, OGG, M4A, AAC, FLAC, and WebM.
Uploads must be non-empty and no larger than 30 MB. The backend generates
filenames from song IDs and does not use a client-supplied path. The current
playlist is in memory: restarting the server starts with an empty list; uploaded
audio remains in `uploads/` until songs are deleted or the directory is cleaned.

## Build and run on Windows (CMD)

### 1. Install a supported compiler

Use **MSYS2 MinGW-w64 UCRT64 GCC**. The legacy MinGW.org GCC 6.3 compiler lacks
the C++ thread support cpp-httplib needs.

1. Install MSYS2 from [msys2.org](https://www.msys2.org/).
2. Open **MSYS2 UCRT64** and update/install the compiler:

   ```sh
   pacman -Syu
   # Reopen the UCRT64 terminal if the update asks you to.
   pacman -S --needed mingw-w64-ucrt-x86_64-gcc
   ```

3. Add `C:\msys64\ucrt64\bin` to the Windows `PATH`, or use the full path to
   `g++.exe` below. The cpp-httplib header and its license are already included
   in `third_party/`; no separate library build is required.

### 2. Compile the web server

In **Command Prompt**, change to this project directory and compile:

```bat
cd /d "D:\Projects\Dsa Project"
g++ -DPLAYLIST_WEB_SERVER -std=c++11 -O2 -Wall -Wextra -pedantic -static -static-libgcc -static-libstdc++ main.cpp -o music_player_server.exe -lws2_32 -lwsock32
```

### 3. Start the server and open the website

For a local-only run, start it with:

```bat
music_player_server.exe
```

Keep the console window open and visit
[http://127.0.0.1:8080/](http://127.0.0.1:8080/) in a browser. Use `Ctrl+C` in
the server window to stop it. Run the server from the project directory so it
can find `index.html`, `style.css`, `script.js`, `spotify.js`, and `uploads/`.
For Spotify, configure the Client ID as described below before starting the
server, then use the same launch command in that section.

The static runtime flags are intentional: they bundle the MinGW C++ runtime and
thread support into the executable. Without them, launching the executable from
a regular CMD may fail before `main()` runs if `C:\msys64\ucrt64\bin` is not on
`PATH`; Windows then cannot find the MinGW runtime DLLs, so none of the
application's startup messages can be printed. Alternatively, keep the
original non-static build command and add the runtime directory before running:

```bat
set "PATH=C:\msys64\ucrt64\bin;%PATH%"
music_player_server.exe
```

The server listens only on `127.0.0.1:8080`. If the port is occupied, close the
other local service and retry.

### Configure Spotify

Spotify is optional; the local upload player works without a Spotify app.

1. Sign in at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
   and create an app.
2. In the app settings, add this exact Redirect URI and save:
   `http://127.0.0.1:8080/`
3. In the app's **Users and Access** (user management) settings, add the
   Spotify account(s) that will sign in. Development-mode apps restrict access
   to allowlisted users (currently up to five) and require the app owner to
   have Premium.
4. Copy the app's **Client ID**. Do not create, copy, or configure a client
   secret for Sonora; this browser app uses Authorization Code with PKCE.
5. Start Sonora from the project directory, open the player, and choose
   **Set Spotify Client ID**. Paste the app's public Client ID and save. Sonora
   writes it to the ignored local file `spotify_config.txt`; it is loaded again
   on the next launch and takes precedence over `SPOTIFY_CLIENT_ID`. The
   environment variable remains a fallback when no saved Client ID exists.

   `SPOTIFY_REDIRECT_URI` is optional because the server defaults to
   `http://127.0.0.1:8080/`. If you change it, the dashboard value, environment value, and
   browser URL must match exactly. Open **http://127.0.0.1:8080/** (not
   `localhost`) so the PKCE verifier remains in the same browser origin during
   Spotify's redirect.

Choose **Connect Spotify**, approve the requested access, and search tracks,
artists, or albums. Track results can be added to Sonora's linked-list playlist
or played immediately. Sonora stores only track metadata and Spotify IDs/URIs;
playback stays within the Spotify Web Playback SDK. Search and playback access
is subject to Spotify's app-development settings and account restrictions. The
app requests `streaming`, `user-read-email`, `user-read-private`,
`user-read-playback-state`, and `user-modify-playback-state` scopes.

The repeat-current setting uses Spotify's repeat-track control. Repeat-playlist
advances through Sonora's linked-list order and wraps according to the C++
playlist repeat mode; it does not ask Spotify to repeat an external playlist.

### Spotify limitations and troubleshooting

- Web Playback SDK playback requires Spotify Premium and a supported browser.
  The Spotify browser player must be ready and may require a user gesture.
- Development-mode accounts must be allowlisted in the Developer Dashboard;
  app-owner Premium and the development user limit apply.
- If login reports a redirect error, use `http://127.0.0.1:8080/` everywhere:
  app settings, `SPOTIFY_REDIRECT_URI`, and the URL in the address bar. Do not
  use `localhost`, HTTPS, a different port, or a missing/extra slash.
- If Spotify is not configured, use **Set Spotify Client ID** in Sonora and
  save the public Client ID. No restart or environment-variable setup is needed.
- The server prints `Spotify Client ID detected: yes` or `no` at startup. Open
  `http://127.0.0.1:8080/api/spotify/config` to inspect the JSON diagnostic;
  `clientIdDetected` must be `true`. The ID is not printed in startup logs.
- If that endpoint returns `clientIdDetected: false`, the running process did
  not load a Client ID. Configure it through the app; the endpoint refreshes
  immediately and reports `configured: true`. The HTML, JavaScript, and config
  response use `Cache-Control: no-store`.
- If Connect Spotify reports that the settings endpoint is unavailable or
  returns 404, the server process is an older build. Stop it, rebuild
  `music_player_server.exe` with the command above, and restart from this
  project directory. The Client ID is provided to browser code by the C++
  server's `/api/spotify/config` endpoint; Windows environment variables are
  not automatically available in browser JavaScript.
- If search or playback is denied, check that the signed-in account is
  allowlisted, has the required plan for playback, and has approved the
  requested scopes. A browser extension or network policy may block Spotify's
  SDK/API; allow `sdk.scdn.co`, `accounts.spotify.com`, and `api.spotify.com`.
- OAuth token exchange errors show Spotify's HTTP status and OAuth error code
  and description, without displaying the authorization code, verifier, or
  tokens. If Web Playback reports an authentication error after token exchange,
  Sonora now distinguishes that SDK failure from an expired OAuth session and
  does not replace a failed `/me` profile response with a generic SDK error.
- Spotify Web API failures show the calling endpoint, HTTP status, response
  Content-Type, error code, and a short sanitized response-body excerpt. This
  distinguishes failures from `/me`, `/search`, and playback endpoints without
  exposing credentials or bearer tokens.
- Disconnect clears Sonora's tab-scoped tokens. Reconnect if the authorization
  is revoked; access tokens refresh automatically when a valid refresh token
  remains available.

### API integration test

With a freshly started server and an empty playlist, run:

```bat
python tests\test_spotify_api.py
```

The test submits synthetic Spotify-shaped metadata directly to the local API
to exercise insertion, duplicate rejection, list ordering, and safe deletion
of the current node. It does not mock catalog search or verify Spotify login or
real-account playback. If port 8080 is already occupied, build with
`-DPLAYLIST_WEB_SERVER_PORT=8081` and run the test with
`set "SONORA_TEST_URL=http://127.0.0.1:8081"` first. For Spotify OAuth on that
alternate port, set `SPOTIFY_REDIRECT_URI` to the matching loopback URL and add
that exact URI in the Developer Dashboard.

## Keep using the console application

Compile the same `main.cpp` **without** the web-server define:

```bat
g++ -std=c++11 -O2 -Wall -Wextra -pedantic main.cpp -o playlist_console.exe
playlist_console.exe
```

This retains the original menu-based DSA demonstration, including linked-list
insertion/deletion, forward/backward display, search, repeat, sort, shuffle,
and reverse.

## Sample API requests

Get the current list:

```bat
curl http://127.0.0.1:8080/api/playlist
```

Select a track (replace `1` with a song ID from the playlist response):

```bat
curl -X POST http://127.0.0.1:8080/api/play/ -H "Content-Type: application/json" -d "{\"id\":1}"
```

Upload a file from CMD:

```bat
curl -X POST http://127.0.0.1:8080/api/songs -F "title=Blue in Green" -F "artist=Miles Davis" -F "duration=337" -F "audio=@C:\Music\blue-in-green.mp3"
```

## DSA complexity

For `n` songs, position/ID lookup starts from the closer list end when
applicable. The temporary shuffle pointer array is not playlist storage.

| Operation | Time | Extra space |
|---|---:|---:|
| Append at tail | O(1) | O(1) |
| Insert at beginning/end | O(1) | O(1) |
| Insert at arbitrary position | O(n) | O(1) |
| Delete by ID/title/position | O(n) | O(1) |
| Search by title/artist | O(n) | O(1) |
| Display/traverse | O(n) | O(1) |
| Play next/previous | O(1) | O(1) |
| Select by ID/position | O(n) | O(1) |
| Reverse | O(n) | O(1) |
| Shuffle | O(n) expected | O(n) temporary node pointers |
| Sort by title (merge sort) | O(n log n) | O(log n) recursion |
| Clear | O(n) | O(1) |

## Future enhancements

- Persist playlist metadata across server restarts without replacing the
  linked-list runtime source of truth.
- Support named/multiple playlists while retaining a linked list per playlist.
- Extract metadata and artwork from local audio files.
- Add drag-and-drop reordering, keyboard playback shortcuts, and automated
  browser tests.
