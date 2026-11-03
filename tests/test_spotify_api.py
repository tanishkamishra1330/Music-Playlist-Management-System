import json
import os
import secrets
import urllib.error
import urllib.request


BASE_URL = os.environ.get("SONORA_TEST_URL", "http://127.0.0.1:8080")


def request(path, method="GET", body=None, headers=None, expected=200):
    request_object = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers=headers or {},
        method=method,
    )
    try:
        with urllib.request.urlopen(request_object, timeout=5) as response:
            status = response.status
            response_body = response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        response_body = error.read()
    except urllib.error.URLError as error:
        raise AssertionError(
            "Cannot reach Sonora at {}. Start the server first.".format(BASE_URL)
        ) from error

    if status != expected:
        raise AssertionError(
            "{} {} returned {}, expected {}: {}".format(
                method, path, status, expected, response_body.decode("utf-8", "replace")
            )
        )
    return json.loads(response_body.decode("utf-8")) if response_body else {}


def multipart(fields):
    boundary = "SonoraTest" + secrets.token_hex(12)
    chunks = []
    for name, value in fields.items():
        chunks.extend(
            [
                "--{}\r\n".format(boundary),
                'Content-Disposition: form-data; name="{}"\r\n\r\n'.format(name),
                "{}\r\n".format(value),
            ]
        )
    chunks.append("--{}--\r\n".format(boundary))
    body = "".join(chunks).encode("utf-8")
    return body, {"Content-Type": "multipart/form-data; boundary={}".format(boundary)}


def add_test_track(spotify_id, title):
    fields = {
        "title": title,
        "artist": "Sonora API test",
        "duration": "180",
        "spotifyId": spotify_id,
        "spotifyUri": "spotify:track:" + spotify_id,
        "album": "Sonora test album",
        "artworkUrl": "",
    }
    body, headers = multipart(fields)
    return request(
        "/api/songs/spotify",
        method="POST",
        body=body,
        headers=headers,
        expected=201,
    )["song"]


def main():
    initial = request("/api/playlist")
    if initial["count"] != 0:
        raise AssertionError("Run this integration test with an empty playlist.")

    prefix = "test" + secrets.token_hex(10)
    added_ids = []
    try:
        first = add_test_track(prefix + "01", "Zeta Sonora Test")
        added_ids.append(first["id"])
        second = add_test_track(prefix + "02", "Alpha Sonora Test")
        added_ids.append(second["id"])
        third = add_test_track(prefix + "03", "Middle Sonora Test")
        added_ids.append(third["id"])

        assert first["source"] == "spotify"
        assert first["spotifyUri"] == "spotify:track:" + prefix + "01"
        assert first["audioUrl"] is None

        duplicate_fields = {
            "title": first["title"],
            "artist": first["artist"],
            "duration": "180",
            "spotifyId": prefix + "01",
            "spotifyUri": "spotify:track:" + prefix + "01",
            "album": "Sonora test album",
            "artworkUrl": "",
        }
        duplicate_body, duplicate_headers = multipart(duplicate_fields)
        request(
            "/api/songs/spotify",
            method="POST",
            body=duplicate_body,
            headers=duplicate_headers,
            expected=409,
        )

        ordered = request("/api/sort", method="POST")
        assert [song["title"] for song in ordered["songs"]] == sorted(
            (song["title"] for song in ordered["songs"]),
            key=str.lower,
        )
        ordered_ids = [song["id"] for song in ordered["songs"]]
        reversed_playlist = request("/api/reverse", method="POST")
        assert reversed_playlist["count"] == 3
        assert [song["id"] for song in reversed_playlist["songs"]] == list(
            reversed(ordered_ids)
        )
        shuffled = request("/api/shuffle", method="POST")
        assert shuffled["count"] == 3
        assert len({song["id"] for song in shuffled["songs"]}) == 3

        current = shuffled["songs"][0]
        successor_id = shuffled["songs"][1]["id"]
        request(
            "/api/play/",
            method="POST",
            body=json.dumps({"id": current["id"]}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        after_delete = request(
            "/api/songs/",
            method="DELETE",
            body=json.dumps({"id": current["id"]}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )["playlist"]
        added_ids.remove(current["id"])
        assert after_delete["currentId"] == successor_id

        print("Spotify metadata insertion, duplicate check, linked-list ordering,")
        print("and current-node deletion passed.")
    finally:
        for song_id in added_ids:
            try:
                request(
                    "/api/songs/",
                    method="DELETE",
                    body=json.dumps({"id": song_id}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
            except AssertionError as error:
                if "returned 404" not in str(error):
                    raise


if __name__ == "__main__":
    main()
