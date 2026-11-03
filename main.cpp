#include <cctype>
#include <cerrno>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <cstdio>

#ifdef PLAYLIST_WEB_SERVER
#ifndef PLAYLIST_WEB_SERVER_PORT
#define PLAYLIST_WEB_SERVER_PORT 8080
#endif
#include "third_party/httplib.h"
#include <fstream>
#include <mutex>
#include <cstdlib>
#ifdef _WIN32
#include <direct.h>
#else
#include <sys/stat.h>
#endif
#endif

enum class SongSource {
    Local,
    Spotify
};

struct SongNode {
    int id;
    std::string title;
    std::string artist;
    int durationSeconds;
    SongSource source;
    std::string audioFilePath;
    std::string spotifyId;
    std::string spotifyUri;
    std::string album;
    std::string artworkUrl;
    SongNode* next;
    SongNode* previous;

    SongNode(int songId, const std::string& songTitle,
             const std::string& songArtist, int duration,
             const std::string& audioPath = std::string(),
             SongSource songSource = SongSource::Local,
             const std::string& trackSpotifyId = std::string(),
             const std::string& trackSpotifyUri = std::string(),
             const std::string& trackAlbum = std::string(),
             const std::string& trackArtworkUrl = std::string())
        : id(songId),
          title(songTitle),
          artist(songArtist),
          durationSeconds(duration),
          source(songSource),
          audioFilePath(audioPath),
          spotifyId(trackSpotifyId),
          spotifyUri(trackSpotifyUri),
          album(trackAlbum),
          artworkUrl(trackArtworkUrl),
          next(nullptr),
          previous(nullptr) {}
};

enum class RepeatMode {
    Off,
    One,
    All
};

class Playlist {
public:
    explicit Playlist(const std::string& playlistName)
        : name_(playlistName),
          head_(nullptr),
          tail_(nullptr),
          current_(nullptr),
          songCount_(0),
          nextSongId_(1),
          repeatMode_(RepeatMode::Off) {}

    ~Playlist() {
        clear();
    }

    Playlist(const Playlist&) = delete;
    Playlist& operator=(const Playlist&) = delete;

    const std::string& name() const {
        return name_;
    }

    int songCount() const {
        return songCount_;
    }

    bool isEmpty() const {
        return head_ == nullptr;
    }

    const SongNode* head() const {
        return head_;
    }

    const SongNode* currentSong() const {
        return current_;
    }

    const SongNode* findById(int songId) const {
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            if (song->id == songId) {
                return song;
            }
        }
        return nullptr;
    }

    bool selectSong(int songId) {
        SongNode* song = head_;
        while (song != nullptr && song->id != songId) {
            song = song->next;
        }
        if (song == nullptr) {
            return false;
        }
        current_ = song;
        return true;
    }

    int nextSongId() const {
        return nextSongId_;
    }

    RepeatMode repeatMode() const {
        return repeatMode_;
    }

    void setRepeatMode(RepeatMode mode) {
        repeatMode_ = mode;
    }

    void createNew(const std::string& playlistName) {
        clear();
        name_ = playlistName;
        repeatMode_ = RepeatMode::Off;
    }

    int addSong(const std::string& title, const std::string& artist,
                int durationSeconds,
                const std::string& audioPath = std::string()) {
        SongNode* song = createSong(title, artist, durationSeconds, audioPath);
        return appendSong(song);
    }

    int addSpotifySong(const std::string& title, const std::string& artist,
                       int durationSeconds, const std::string& spotifyId,
                       const std::string& spotifyUri, const std::string& album,
                       const std::string& artworkUrl) {
        SongNode* song = new SongNode(
            nextSongId_++, title, artist, durationSeconds, std::string(),
            SongSource::Spotify, spotifyId, spotifyUri, album, artworkUrl);
        return appendSong(song);
    }

private:
    int appendSong(SongNode* song) {
        song->previous = tail_;

        if (tail_ != nullptr) {
            tail_->next = song;
        } else {
            head_ = song;
        }

        tail_ = song;
        ++songCount_;
        if (current_ == nullptr) {
            current_ = head_;
        }
        return song->id;
    }

public:
    bool insertSongAt(int position, const std::string& title,
                      const std::string& artist, int durationSeconds) {
        if (position < 1 || position > songCount_ + 1) {
            return false;
        }
        if (position == songCount_ + 1) {
            addSong(title, artist, durationSeconds);
            return true;
        }

        SongNode* nextSong = nodeAt(position);
        SongNode* song = createSong(title, artist, durationSeconds);
        song->next = nextSong;
        song->previous = nextSong->previous;

        if (nextSong->previous != nullptr) {
            nextSong->previous->next = song;
        } else {
            head_ = song;
        }
        nextSong->previous = song;
        ++songCount_;

        if (current_ == nullptr) {
            current_ = song;
        }
        return true;
    }

    bool removeAt(int position) {
        if (position < 1 || position > songCount_) {
            return false;
        }
        return removeNode(nodeAt(position));
    }

    bool removeById(int songId) {
        SongNode* song = head_;
        while (song != nullptr && song->id != songId) {
            song = song->next;
        }
        return removeNode(song);
    }

    int removeByTitle(const std::string& title) {
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            if (equalsIgnoreCase(song->title, title)) {
                removeNode(song);
                return 1;
            }
        }
        return 0;
    }

    void displayForward() const {
        if (isEmpty()) {
            std::cout << "The playlist is empty.\n";
            return;
        }

        std::cout << "\nPlaylist: " << name_ << " (" << songCount_
                  << (songCount_ == 1 ? " song)\n" : " songs)\n");
        printHeader();
        int position = 1;
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            printSong(song, position++);
        }
    }

    void displayBackward() const {
        if (isEmpty()) {
            std::cout << "The playlist is empty.\n";
            return;
        }

        std::cout << "\nPlaylist in reverse order: " << name_ << "\n";
        printHeader();
        int position = songCount_;
        for (SongNode* song = tail_; song != nullptr; song = song->previous) {
            printSong(song, position--);
        }
    }

    int searchTitle(const std::string& title) const {
        int matches = 0;
        int position = 1;
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            if (containsIgnoreCase(song->title, title)) {
                printSong(song, position);
                ++matches;
            }
            ++position;
        }
        return matches;
    }

    int searchArtist(const std::string& artist) const {
        int matches = 0;
        int position = 1;
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            if (containsIgnoreCase(song->artist, artist)) {
                printSong(song, position);
                ++matches;
            }
            ++position;
        }
        return matches;
    }

    bool playAt(int position) {
        SongNode* song = nodeAt(position);
        if (song == nullptr) {
            return false;
        }
        current_ = song;
        displayCurrent();
        return true;
    }

    void playCurrent() const {
        if (current_ == nullptr) {
            std::cout << "There is no song to play. Add a song first.\n";
            return;
        }
        displayCurrent();
    }

    void playFirst() {
        if (head_ == nullptr) {
            std::cout << "There is no song to play. Add a song first.\n";
            return;
        }
        current_ = head_;
        displayCurrent();
    }

    void playNext() {
        if (!advanceNext()) {
            if (current_ == nullptr) {
                std::cout << "There is no song to play. Add a song first.\n";
            } else {
                std::cout << "You are at the last song. No next song.\n";
            }
            return;
        }
        displayCurrent();
    }

    bool advanceNext() {
        if (current_ == nullptr) {
            return false;
        }
        if (repeatMode_ == RepeatMode::One) {
            return true;
        }
        if (current_->next != nullptr) {
            current_ = current_->next;
        } else if (repeatMode_ == RepeatMode::All) {
            current_ = head_;
        } else {
            return false;
        }
        return true;
    }

    void playPrevious() {
        if (!advancePrevious()) {
            if (current_ == nullptr) {
                std::cout << "There is no song to play. Add a song first.\n";
            } else {
                std::cout << "You are at the first song. No previous song.\n";
            }
            return;
        }
        displayCurrent();
    }

    bool advancePrevious() {
        if (current_ == nullptr) {
            return false;
        }
        if (repeatMode_ == RepeatMode::One) {
            return true;
        }
        if (current_->previous != nullptr) {
            current_ = current_->previous;
        } else if (repeatMode_ == RepeatMode::All) {
            current_ = tail_;
        } else {
            return false;
        }
        return true;
    }

    void shuffle() {
        if (songCount_ < 2) {
            std::cout << "Add at least two songs to shuffle the playlist.\n";
            return;
        }

        // The array is temporary; the playlist itself remains a linked list.
        SongNode** songs = new SongNode*[songCount_];
        int index = 0;
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            songs[index++] = song;
        }

        static std::mt19937 generator(std::random_device{}());
        for (int i = songCount_ - 1; i > 0; --i) {
            std::uniform_int_distribution<int> pick(0, i);
            const int j = pick(generator);
            SongNode* temporary = songs[i];
            songs[i] = songs[j];
            songs[j] = temporary;
        }

        head_ = songs[0];
        head_->previous = nullptr;
        for (int i = 0; i < songCount_ - 1; ++i) {
            songs[i]->next = songs[i + 1];
            songs[i + 1]->previous = songs[i];
        }
        tail_ = songs[songCount_ - 1];
        tail_->next = nullptr;
        delete[] songs;
        std::cout << "Playlist shuffled. The current song is unchanged.\n";
    }

    void sortByTitle() {
        if (songCount_ < 2) {
            std::cout << "Add at least two songs to sort the playlist.\n";
            return;
        }

        head_ = mergeSort(head_);
        SongNode* previous = nullptr;
        for (SongNode* song = head_; song != nullptr; song = song->next) {
            song->previous = previous;
            previous = song;
        }
        tail_ = previous;
        std::cout << "Playlist sorted alphabetically by title.\n";
    }

    void reverse() {
        SongNode* song = head_;
        while (song != nullptr) {
            SongNode* oldNext = song->next;
            song->next = song->previous;
            song->previous = oldNext;
            song = oldNext;
        }

        SongNode* oldHead = head_;
        head_ = tail_;
        tail_ = oldHead;
        std::cout << "Playlist order reversed.\n";
    }

    void clear() {
        SongNode* song = head_;
        while (song != nullptr) {
            SongNode* nextSong = song->next;
            removeAudioFile(song->audioFilePath);
            delete song;
            song = nextSong;
        }
        head_ = nullptr;
        tail_ = nullptr;
        current_ = nullptr;
        songCount_ = 0;
    }

private:
    std::string name_;
    SongNode* head_;
    SongNode* tail_;
    SongNode* current_;
    int songCount_;
    int nextSongId_;
    RepeatMode repeatMode_;

    static void removeAudioFile(const std::string& path) {
        if (!path.empty() && std::remove(path.c_str()) != 0 &&
            errno != ENOENT) {
            std::cerr << "Could not remove uploaded audio file '" << path
                      << "': " << std::strerror(errno) << "\n";
        }
    }

    SongNode* createSong(const std::string& title, const std::string& artist,
                         int durationSeconds,
                         const std::string& audioPath = std::string()) {
        return new SongNode(nextSongId_++, title, artist, durationSeconds,
                            audioPath);
    }

    SongNode* nodeAt(int position) const {
        if (position < 1 || position > songCount_) {
            return nullptr;
        }

        if (position <= songCount_ / 2 + songCount_ % 2) {
            SongNode* song = head_;
            for (int currentPosition = 1;
                 currentPosition < position; ++currentPosition) {
                song = song->next;
            }
            return song;
        }

        SongNode* song = tail_;
        for (int currentPosition = songCount_;
             currentPosition > position; --currentPosition) {
            song = song->previous;
        }
        return song;
    }

    bool removeNode(SongNode* song) {
        if (song == nullptr) {
            return false;
        }

        if (song->previous != nullptr) {
            song->previous->next = song->next;
        } else {
            head_ = song->next;
        }
        if (song->next != nullptr) {
            song->next->previous = song->previous;
        } else {
            tail_ = song->previous;
        }

        if (current_ == song) {
            current_ = song->next != nullptr ? song->next : song->previous;
        }

        removeAudioFile(song->audioFilePath);
        delete song;
        --songCount_;
        if (songCount_ == 0) {
            head_ = nullptr;
            tail_ = nullptr;
            current_ = nullptr;
        }
        return true;
    }

    static std::string lowercase(const std::string& text) {
        std::string result = text;
        for (std::string::size_type i = 0; i < result.size(); ++i) {
            result[i] = static_cast<char>(
                std::tolower(static_cast<unsigned char>(result[i])));
        }
        return result;
    }

    static bool equalsIgnoreCase(const std::string& left,
                                 const std::string& right) {
        return lowercase(left) == lowercase(right);
    }

    static bool containsIgnoreCase(const std::string& text,
                                   const std::string& query) {
        return lowercase(text).find(lowercase(query)) != std::string::npos;
    }

    static bool comesBefore(const SongNode* left, const SongNode* right) {
        const std::string leftTitle = lowercase(left->title);
        const std::string rightTitle = lowercase(right->title);
        if (leftTitle != rightTitle) {
            return leftTitle < rightTitle;
        }
        const std::string leftArtist = lowercase(left->artist);
        const std::string rightArtist = lowercase(right->artist);
        if (leftArtist != rightArtist) {
            return leftArtist < rightArtist;
        }
        return left->id < right->id;
    }

    static SongNode* mergeSort(SongNode* first) {
        if (first == nullptr || first->next == nullptr) {
            return first;
        }

        SongNode* slow = first;
        SongNode* fast = first->next;
        while (fast != nullptr && fast->next != nullptr) {
            slow = slow->next;
            fast = fast->next->next;
        }

        SongNode* second = slow->next;
        slow->next = nullptr;
        SongNode* left = mergeSort(first);
        SongNode* right = mergeSort(second);
        return merge(left, right);
    }

    static SongNode* merge(SongNode* left, SongNode* right) {
        SongNode dummy(0, "", "", 0);
        SongNode* last = &dummy;

        while (left != nullptr && right != nullptr) {
            if (comesBefore(right, left)) {
                last->next = right;
                right = right->next;
            } else {
                last->next = left;
                left = left->next;
            }
            last = last->next;
        }
        last->next = left != nullptr ? left : right;
        return dummy.next;
    }

    static void printHeader() {
        std::cout << std::left << std::setw(6) << "Pos"
                  << std::setw(7) << "ID"
                  << std::setw(30) << "Title"
                  << std::setw(25) << "Artist"
                  << "Duration\n";
        std::cout << std::string(78, '-') << "\n";
    }

    static void printSong(const SongNode* song, int position) {
        std::cout << std::left << std::setw(6) << position
                  << std::setw(7) << song->id
                  << std::setw(30) << song->title
                  << std::setw(25) << song->artist;
        printDuration(song->durationSeconds);
        std::cout << "\n";
    }

    static void printDuration(int durationSeconds) {
        const int minutes = durationSeconds / 60;
        const int seconds = durationSeconds % 60;
        std::cout << minutes << ":" << std::setfill('0') << std::setw(2)
                  << seconds << std::setfill(' ');
    }

    void displayCurrent() const {
        if (current_ == nullptr) {
            std::cout << "There is no song to play. Add a song first.\n";
            return;
        }

        std::cout << "Now playing (simulated): " << current_->title << " - "
                  << current_->artist << " (";
        printDuration(current_->durationSeconds);
        std::cout << ")\n";
    }
};

bool readInteger(const std::string& prompt, int minimum, int maximum,
                 int& value) {
    while (true) {
        std::cout << prompt;
        std::string input;
        if (!std::getline(std::cin, input)) {
            return false;
        }

        std::istringstream parser(input);
        int parsedValue;
        char extraCharacter;
        if ((parser >> parsedValue) && !(parser >> extraCharacter) &&
            parsedValue >= minimum && parsedValue <= maximum) {
            value = parsedValue;
            return true;
        }
        std::cout << "Invalid input. Enter a whole number from " << minimum
                  << " to " << maximum << ".\n";
    }
}

bool readNonEmptyLine(const std::string& prompt, std::string& value) {
    while (true) {
        std::cout << prompt;
        if (!std::getline(std::cin, value)) {
            return false;
        }
        if (value.find_first_not_of(" \t\r\n") != std::string::npos) {
            return true;
        }
        std::cout << "This field cannot be empty.\n";
    }
}

bool readSongDetails(std::string& title, std::string& artist, int& duration) {
    if (!readNonEmptyLine("Song title: ", title) ||
        !readNonEmptyLine("Artist name: ", artist)) {
        return false;
    }
    return readInteger("Duration in seconds (1-86400): ", 1, 86400, duration);
}

void printMenu(const Playlist& playlist) {
    std::cout << "\n========== Music Playlist Management System ==========\n"
              << "Playlist: " << playlist.name() << " | Songs: "
              << playlist.songCount() << "\n"
              << "1.  Add Song\n"
              << "2.  Insert Song at Position\n"
              << "3.  Remove Song\n"
              << "4.  Display Playlist\n"
              << "5.  Search Song\n"
              << "6.  Play Current Song\n"
              << "7.  Next Song\n"
              << "8.  Previous Song\n"
              << "9.  Play Song by Position\n"
              << "10. Shuffle Playlist\n"
              << "11. Sort Playlist\n"
              << "12. Reverse Playlist\n"
              << "13. Repeat Mode\n"
              << "14. Clear Playlist\n"
              << "15. Display Song Count\n"
              << "16. Exit\n"
              << "17. Create New Playlist\n"
              << "18. Display Songs by Artist\n"
              << "19. Display Playlist Backward\n"
              << "20. Play First Song\n"
              << "======================================================\n";
}

bool addSong(Playlist& playlist, bool atPosition) {
    int position = 0;
    if (atPosition &&
        !readInteger("Insert at position (1-" +
                         std::to_string(playlist.songCount() + 1) + "): ",
                     1, playlist.songCount() + 1, position)) {
        return false;
    }

    std::string title;
    std::string artist;
    int duration = 0;
    if (!readSongDetails(title, artist, duration)) {
        return false;
    }

    if (atPosition) {
        playlist.insertSongAt(position, title, artist, duration);
        std::cout << "Song inserted at position " << position << ".\n";
    } else {
        playlist.addSong(title, artist, duration);
        std::cout << "Song added to the end of the playlist.\n";
    }
    return true;
}

bool removeSong(Playlist& playlist) {
    if (playlist.isEmpty()) {
        std::cout << "The playlist is empty; there is nothing to remove.\n";
        return true;
    }

    int method = 0;
    if (!readInteger("Remove by: 1. Title  2. Position: ", 1, 2, method)) {
        return false;
    }
    if (method == 1) {
        std::string title;
        if (!readNonEmptyLine("Exact song title: ", title)) {
            return false;
        }
        if (playlist.removeByTitle(title) == 0) {
            std::cout << "No song with that title was found.\n";
        } else {
            std::cout << "Song removed.\n";
        }
        return true;
    }

    int position = 0;
    if (!readInteger("Song position: ", 1, playlist.songCount(), position)) {
        return false;
    }
    playlist.removeAt(position);
    std::cout << "Song at position " << position << " removed.\n";
    return true;
}

bool searchSongs(const Playlist& playlist) {
    int method = 0;
    if (!readInteger("Search by: 1. Title  2. Artist: ", 1, 2, method)) {
        return false;
    }
    std::string query;
    if (!readNonEmptyLine(method == 1 ? "Title to search for: "
                                      : "Artist to search for: ",
                          query)) {
        return false;
    }

    std::cout << "\nSearch results:\n";
    const int matches =
        method == 1 ? playlist.searchTitle(query) : playlist.searchArtist(query);
    if (matches == 0) {
        std::cout << "No matching songs found.\n";
    }
    return true;
}

bool setRepeatMode(Playlist& playlist) {
    int mode = 0;
    if (!readInteger("Repeat mode: 0. Off  1. Current Song  2. Entire Playlist: ",
                     0, 2, mode)) {
        return false;
    }
    playlist.setRepeatMode(mode == 1 ? RepeatMode::One
                                     : mode == 2 ? RepeatMode::All
                                                 : RepeatMode::Off);
    std::cout << "Repeat mode set to "
              << (mode == 1 ? "current song" : mode == 2 ? "entire playlist"
                                                         : "off")
              << ".\n";
    return true;
}

bool handleChoice(Playlist& playlist, int choice) {
    switch (choice) {
        case 1:
            return addSong(playlist, false);
        case 2:
            return addSong(playlist, true);
        case 3:
            return removeSong(playlist);
        case 4:
            playlist.displayForward();
            return true;
        case 5:
            return searchSongs(playlist);
        case 6:
            playlist.playCurrent();
            return true;
        case 7:
            playlist.playNext();
            return true;
        case 8:
            playlist.playPrevious();
            return true;
        case 9: {
            if (playlist.isEmpty()) {
                std::cout << "The playlist is empty; there is no position to play.\n";
                return true;
            }
            int position = 0;
            if (!readInteger("Song position: ", 1, playlist.songCount(), position)) {
                return false;
            }
            playlist.playAt(position);
            return true;
        }
        case 10:
            playlist.shuffle();
            return true;
        case 11:
            playlist.sortByTitle();
            return true;
        case 12:
            playlist.reverse();
            return true;
        case 13:
            return setRepeatMode(playlist);
        case 14: {
            std::string confirmation;
            if (!readNonEmptyLine("Clear all songs? (y/n): ", confirmation)) {
                return false;
            }
            if (confirmation == "y" || confirmation == "Y" ||
                confirmation == "yes" || confirmation == "YES") {
                playlist.clear();
                std::cout << "Playlist cleared.\n";
            } else {
                std::cout << "Clear cancelled.\n";
            }
            return true;
        }
        case 15:
            std::cout << "Total songs: " << playlist.songCount() << "\n";
            return true;
        case 16:
            return false;
        case 17: {
            std::string name;
            if (!readNonEmptyLine("New playlist name: ", name)) {
                return false;
            }
            playlist.createNew(name);
            std::cout << "New playlist created: " << playlist.name() << "\n";
            return true;
        }
        case 18: {
            std::string artist;
            if (!readNonEmptyLine("Artist name to display: ", artist)) {
                return false;
            }
            std::cout << "\nSongs by " << artist << ":\n";
            const int matches = playlist.searchArtist(artist);
            if (matches == 0) {
                std::cout << "No songs found for that artist.\n";
            }
            return true;
        }
        case 19:
            playlist.displayBackward();
            return true;
        case 20:
            playlist.playFirst();
            return true;
        default:
            std::cout << "Invalid menu choice.\n";
            return true;
    }
}

int main() {
#ifdef PLAYLIST_WEB_SERVER
    Playlist playlist("Your Library");
    std::mutex playlistMutex;
    httplib::Server server;
    server.set_payload_max_length(32 * 1024 * 1024);

    const auto jsonEscape = [](const std::string& value) {
        std::ostringstream escaped;
        for (std::string::size_type i = 0; i < value.size(); ++i) {
            const unsigned char character =
                static_cast<unsigned char>(value[i]);
            switch (character) {
                case '"':
                    escaped << "\\\"";
                    break;
                case '\\':
                    escaped << "\\\\";
                    break;
                case '\b':
                    escaped << "\\b";
                    break;
                case '\f':
                    escaped << "\\f";
                    break;
                case '\n':
                    escaped << "\\n";
                    break;
                case '\r':
                    escaped << "\\r";
                    break;
                case '\t':
                    escaped << "\\t";
                    break;
                default:
                    if (character < 0x20) {
                        const char hex[] = "0123456789abcdef";
                        escaped << "\\u00" << hex[character >> 4]
                                << hex[character & 0x0f];
                    } else {
                        escaped << static_cast<char>(character);
                    }
            }
        }
        return escaped.str();
    };

    const auto songJson = [&jsonEscape](const SongNode* song) {
        if (song == nullptr) {
            return std::string("null");
        }
        std::ostringstream json;
        json << "{\"id\":" << song->id << ",\"title\":\""
             << jsonEscape(song->title) << "\",\"artist\":\""
             << jsonEscape(song->artist) << "\",\"duration\":"
             << song->durationSeconds << ",\"source\":\""
             << (song->source == SongSource::Spotify ? "spotify" : "local")
             << "\",\"spotifyId\":";
        if (song->source == SongSource::Spotify) {
            json << "\"" << jsonEscape(song->spotifyId) << "\"";
        } else {
            json << "null";
        }
        json << ",\"spotifyUri\":";
        if (song->source == SongSource::Spotify) {
            json << "\"" << jsonEscape(song->spotifyUri) << "\"";
        } else {
            json << "null";
        }
        json << ",\"album\":\"" << jsonEscape(song->album)
             << "\",\"artworkUrl\":\"" << jsonEscape(song->artworkUrl)
             << "\",\"audioUrl\":";
        if (song->source == SongSource::Local) {
            json << "\"/" << jsonEscape(song->audioFilePath) << "\"";
        } else {
            json << "null";
        }
        json << "}";
        return json.str();
    };

    const auto repeatModeName = [](RepeatMode mode) {
        switch (mode) {
            case RepeatMode::One:
                return "one";
            case RepeatMode::All:
                return "all";
            default:
                return "off";
        }
    };

    const auto playlistJson =
        [&playlist, &songJson, &repeatModeName, &jsonEscape]() {
        std::ostringstream json;
        const SongNode* current = playlist.currentSong();
        json << "{\"name\":\"" << jsonEscape(playlist.name())
             << "\",\"count\":" << playlist.songCount()
             << ",\"currentId\":";
        if (current == nullptr) {
            json << "null";
        } else {
            json << current->id;
        }
        json << ",\"repeat\":\"" << repeatModeName(playlist.repeatMode())
             << "\",\"songs\":[";
        bool first = true;
        for (const SongNode* song = playlist.head(); song != nullptr;
             song = song->next) {
            if (!first) {
                json << ',';
            }
            json << songJson(song);
            first = false;
        }
        json << "]}";
        return json.str();
    };

    const auto sendJson = [](httplib::Response& response, int status,
                             const std::string& body) {
        response.status = status;
        response.set_content(body, "application/json; charset=utf-8");
    };

    const auto sendError = [&sendJson](httplib::Response& response, int status,
                                       const std::string& message) {
        std::ostringstream json;
        json << "{\"error\":\"";
        for (std::string::size_type i = 0; i < message.size(); ++i) {
            if (message[i] == '"' || message[i] == '\\') {
                json << '\\';
            }
            if (message[i] != '\n' && message[i] != '\r') {
                json << message[i];
            }
        }
        json << "\"}";
        sendJson(response, status, json.str());
    };

    const auto readJsonInteger = [](const std::string& body,
                                    const std::string& key, int& value) {
        const std::string quotedKey = "\"" + key + "\"";
        std::string::size_type position = body.find(quotedKey);
        if (position == std::string::npos) {
            return false;
        }
        position = body.find(':', position + quotedKey.size());
        if (position == std::string::npos) {
            return false;
        }
        ++position;
        while (position < body.size() &&
               std::isspace(static_cast<unsigned char>(body[position]))) {
            ++position;
        }
        if (position == body.size()) {
            return false;
        }
        char* end = nullptr;
        const long parsed = std::strtol(body.c_str() + position, &end, 10);
        if (end == body.c_str() + position || parsed < 1 ||
            parsed > 2147483647L) {
            return false;
        }
        while (*end != '\0' &&
               std::isspace(static_cast<unsigned char>(*end))) {
            ++end;
        }
        if (*end != ',' && *end != '}') {
            return false;
        }
        value = static_cast<int>(parsed);
        return true;
    };

    const auto readJsonString = [](const std::string& body,
                                   const std::string& key,
                                   std::string& value) {
        const std::string quotedKey = "\"" + key + "\"";
        std::string::size_type position = body.find(quotedKey);
        if (position == std::string::npos) {
            return false;
        }
        position = body.find(':', position + quotedKey.size());
        if (position == std::string::npos) {
            return false;
        }
        ++position;
        while (position < body.size() &&
               std::isspace(static_cast<unsigned char>(body[position]))) {
            ++position;
        }
        if (position == body.size() || body[position] != '"') {
            return false;
        }
        ++position;
        const std::string::size_type end = body.find('"', position);
        if (end == std::string::npos) {
            return false;
        }
        value = body.substr(position, end - position);
        return true;
    };

    const auto validText = [](const std::string& value, std::size_t maximum) {
        return !value.empty() &&
               value.find_first_not_of(" \t\r\n") != std::string::npos &&
               value.size() <= maximum;
    };

    const auto extensionOf = [](const std::string& filename) {
        const std::string::size_type dot = filename.find_last_of('.');
        if (dot == std::string::npos || dot + 1 == filename.size()) {
            return std::string();
        }
        std::string extension = filename.substr(dot);
        for (std::string::size_type i = 0; i < extension.size(); ++i) {
            extension[i] = static_cast<char>(
                std::tolower(static_cast<unsigned char>(extension[i])));
        }
        return extension;
    };

    const auto readAsset = [](const std::string& path, std::string& content) {
        std::ifstream file(path.c_str(), std::ios::binary);
        if (!file) {
            return false;
        }
        std::ostringstream buffer;
        buffer << file.rdbuf();
        if (file.bad()) {
            return false;
        }
        content = buffer.str();
        return true;
    };

    const auto validSpotifyClientId = [](const std::string& value) {
        if (value.empty() || value.size() > 128) {
            return false;
        }
        for (std::string::size_type i = 0; i < value.size(); ++i) {
            const unsigned char character =
                static_cast<unsigned char>(value[i]);
            if (!std::isalnum(character) && character != '-' &&
                character != '_') {
                return false;
            }
        }
        return true;
    };

    std::string spotifyClientId;
    std::ifstream savedConfig("spotify_config.txt", std::ios::binary);
    std::string savedClientId;
    if (savedConfig && std::getline(savedConfig, savedClientId) &&
        validSpotifyClientId(savedClientId)) {
        spotifyClientId = savedClientId;
    }
    if (spotifyClientId.empty()) {
        const char* configuredClientId = std::getenv("SPOTIFY_CLIENT_ID");
        if (configuredClientId != nullptr &&
            validSpotifyClientId(configuredClientId)) {
            spotifyClientId = configuredClientId;
        }
    }
    std::mutex spotifyConfigMutex;
    const char* configuredRedirectUri = std::getenv("SPOTIFY_REDIRECT_URI");
    const std::string spotifyRedirectUri =
        configuredRedirectUri == nullptr || configuredRedirectUri[0] == '\0'
            ? "http://127.0.0.1:8080/"
            : configuredRedirectUri;

    server.Get("/", [&readAsset](const httplib::Request&,
                                 httplib::Response& response) {
        std::string content;
        if (!readAsset("index.html", content)) {
            response.status = 500;
            response.set_content("Could not read index.html.", "text/plain");
            return;
        }
        response.set_content(content, "text/html; charset=utf-8");
        response.set_header("Cache-Control", "no-store");
    });

    server.Get("/style.css", [&readAsset](const httplib::Request&,
                                         httplib::Response& response) {
        std::string content;
        if (!readAsset("style.css", content)) {
            response.status = 500;
            response.set_content("Could not read style.css.", "text/plain");
            return;
        }
        response.set_content(content, "text/css; charset=utf-8");
        response.set_header("Cache-Control", "no-store");
    });

    server.Get("/script.js", [&readAsset](const httplib::Request&,
                                         httplib::Response& response) {
        std::string content;
        if (!readAsset("script.js", content)) {
            response.status = 500;
            response.set_content("Could not read script.js.", "text/plain");
            return;
        }
        response.set_content(content, "application/javascript; charset=utf-8");
        response.set_header("Cache-Control", "no-store");
    });

    server.Get("/spotify.js", [&readAsset](const httplib::Request&,
                                          httplib::Response& response) {
        std::string content;
        if (!readAsset("spotify.js", content)) {
            response.status = 500;
            response.set_content("Could not read spotify.js.", "text/plain");
            return;
        }
        response.set_content(content, "application/javascript; charset=utf-8");
        response.set_header("Cache-Control", "no-store");
    });

    server.Get(R"(/uploads/([A-Za-z0-9_.-]+))",
               [](const httplib::Request& request,
                  httplib::Response& response) {
                   const std::string filename = request.matches[1].str();
                   if (filename.find("song_") != 0) {
                       response.status = 404;
                       return;
                   }
                   const std::string path = "uploads/" + filename;
                   std::ifstream file(path.c_str(),
                                      std::ios::binary | std::ios::ate);
                   if (!file) {
                       response.status = 404;
                       response.set_content("Audio file not found.",
                                            "text/plain");
                       return;
                   }
                   const std::streamoff fileSize = file.tellg();
                   file.close();
                   if (fileSize <= 0) {
                       response.status = 404;
                       response.set_content("Audio file is empty or unreadable.",
                                            "text/plain");
                       return;
                   }
                   const std::string extension = filename.substr(
                       filename.find_last_of('.') == std::string::npos
                           ? filename.size()
                           : filename.find_last_of('.'));
                   const char* mime = "application/octet-stream";
                   if (extension == ".mp3") mime = "audio/mpeg";
                   if (extension == ".wav") mime = "audio/wav";
                   if (extension == ".ogg") mime = "audio/ogg";
                   if (extension == ".m4a") mime = "audio/mp4";
                   if (extension == ".aac") mime = "audio/aac";
                   if (extension == ".flac") mime = "audio/flac";
                   if (extension == ".webm") mime = "audio/webm";
                   response.set_header("Accept-Ranges", "bytes");
                   response.set_content_provider(
                       static_cast<std::size_t>(fileSize), mime,
                       [path](std::size_t offset, std::size_t length,
                              httplib::DataSink& sink) {
                           if (length == 0) {
                               return true;
                           }
                           std::ifstream audioFile(path.c_str(),
                                                   std::ios::binary);
                           if (!audioFile) {
                               return false;
                           }
                           audioFile.seekg(
                               static_cast<std::streamoff>(offset));
                           std::string chunk(length, '\0');
                           audioFile.read(
                               &chunk[0],
                               static_cast<std::streamsize>(length));
                           if (static_cast<std::size_t>(audioFile.gcount()) !=
                               length) {
                               return false;
                           }
                           return sink.write(chunk.data(), chunk.size());
                       });
               });

    server.Get("/api/playlist",
               [&playlist, &playlistMutex, &playlistJson](
                   const httplib::Request&, httplib::Response& response) {
                   std::lock_guard<std::mutex> lock(playlistMutex);
                   response.set_content(playlistJson(),
                                        "application/json; charset=utf-8");
               });

    server.Get("/api/current",
               [&playlist, &playlistMutex, &songJson, &sendJson](
                   const httplib::Request&, httplib::Response& response) {
                   std::lock_guard<std::mutex> lock(playlistMutex);
                   sendJson(response, 200,
                            std::string("{\"song\":") +
                                songJson(playlist.currentSong()) + "}");
               });

    server.Get("/api/spotify/config",
               [&spotifyClientId, &spotifyConfigMutex, &spotifyRedirectUri,
                &jsonEscape, &sendJson](
                   const httplib::Request&, httplib::Response& response) {
                   std::string clientId;
                   {
                       std::lock_guard<std::mutex> lock(spotifyConfigMutex);
                       clientId = spotifyClientId;
                   }
                   const bool clientIdDetected = !clientId.empty();
                   std::ostringstream json;
                   json << "{\"configured\":"
                        << (clientIdDetected ? "true" : "false")
                        << ",\"clientIdDetected\":"
                        << (clientIdDetected ? "true" : "false")
                        << ",\"clientId\":\""
                        << jsonEscape(clientId)
                        << "\",\"redirectUri\":\""
                        << jsonEscape(spotifyRedirectUri) << "\"}";
                   sendJson(response, 200, json.str());
                   response.set_header("Cache-Control", "no-store");
               });

    server.Post("/api/spotify/config",
                [&spotifyClientId, &spotifyConfigMutex, &spotifyRedirectUri,
                 &validSpotifyClientId, &readJsonString, &jsonEscape,
                 &sendJson, &sendError](
                    const httplib::Request& request,
                    httplib::Response& response) {
                    std::string clientId;
                    if (!readJsonString(request.body, "clientId", clientId) ||
                        !validSpotifyClientId(clientId)) {
                        sendError(response, 400,
                                  "Client ID must contain 1-128 letters, digits, hyphens, or underscores.");
                        return;
                    }

                    std::lock_guard<std::mutex> lock(spotifyConfigMutex);
                    std::ofstream savedConfig("spotify_config.txt",
                                              std::ios::binary | std::ios::trunc);
                    if (!savedConfig) {
                        sendError(response, 500,
                                  "Could not open spotify_config.txt for writing. Run Sonora from a writable project folder.");
                        return;
                    }
                    savedConfig << clientId << '\n';
                    savedConfig.flush();
                    if (!savedConfig) {
                        sendError(response, 500,
                                  "Could not save Spotify configuration to spotify_config.txt.");
                        return;
                    }
                    savedConfig.close();

                    spotifyClientId = clientId;
                    std::ostringstream json;
                    json << "{\"configured\":true"
                         << ",\"clientIdDetected\":true"
                         << ",\"clientId\":\"" << jsonEscape(clientId)
                         << "\",\"redirectUri\":\""
                         << jsonEscape(spotifyRedirectUri) << "\""
                         << ",\"message\":\"Spotify Client ID saved locally.\"}";
                    sendJson(response, 200, json.str());
                    response.set_header("Cache-Control", "no-store");
                });

    server.Post("/api/songs",
                [&playlist, &playlistMutex, &sendJson, &sendError, &songJson,
                 &validText, &extensionOf](
                    const httplib::Request& request,
                    httplib::Response& response) {
                    if (!request.has_file("title") ||
                        !request.has_file("artist") ||
                        !request.has_file("duration") ||
                        !request.has_file("audio")) {
                        sendError(response, 400,
                                  "Provide title, artist, duration, and an audio file.");
                        return;
                    }
                    const std::string title =
                        request.get_file_value("title").content;
                    const std::string artist =
                        request.get_file_value("artist").content;
                    const std::string durationText =
                        request.get_file_value("duration").content;
                    if (!validText(title, 160) || !validText(artist, 120)) {
                        sendError(response, 400,
                                  "Title and artist must be non-empty and within their length limits.");
                        return;
                    }
                    char* end = nullptr;
                    const long duration =
                        std::strtol(durationText.c_str(), &end, 10);
                    if (durationText.empty() || end == durationText.c_str() ||
                        *end != '\0' || duration < 1 || duration > 86400) {
                        sendError(response, 400,
                                  "Duration must be a whole number from 1 to 86400 seconds.");
                        return;
                    }

                    const httplib::MultipartFormData audio =
                        request.get_file_value("audio");
                    const std::string extension = extensionOf(audio.filename);
                    const char* allowedExtensions[] = {
                        ".mp3", ".wav", ".ogg", ".m4a",
                        ".aac", ".flac", ".webm"};
                    bool extensionAllowed = false;
                    for (std::size_t i = 0;
                         i < sizeof(allowedExtensions) /
                                 sizeof(allowedExtensions[0]);
                         ++i) {
                        if (extension == allowedExtensions[i]) {
                            extensionAllowed = true;
                            break;
                        }
                    }
                    if (!extensionAllowed || audio.content.empty() ||
                        audio.content.size() > 30 * 1024 * 1024) {
                        sendError(response, 400,
                                  "Upload a non-empty audio file (MP3, WAV, OGG, M4A, AAC, FLAC, or WebM), up to 30 MB.");
                        return;
                    }

                    std::lock_guard<std::mutex> lock(playlistMutex);
                    const int songId = playlist.nextSongId();
                    std::ostringstream filename;
                    filename << "uploads/song_" << songId << extension;
                    std::ofstream output(filename.str().c_str(),
                                         std::ios::binary);
                    if (!output) {
                        sendError(response, 500,
                                  "Could not open the uploads folder for writing.");
                        return;
                    }
                    output.write(audio.content.data(),
                                 static_cast<std::streamsize>(
                                     audio.content.size()));
                    output.close();
                    if (!output) {
                        std::remove(filename.str().c_str());
                        sendError(response, 500,
                                  "Could not save the uploaded audio file.");
                        return;
                    }

                    playlist.addSong(title, artist,
                                     static_cast<int>(duration),
                                     filename.str());
                    sendJson(response, 201,
                             std::string("{\"song\":") +
                                 songJson(playlist.findById(songId)) + "}");
                });

    server.Post("/api/songs/spotify",
                [&playlist, &playlistMutex, &sendJson, &sendError, &songJson,
                 &validText](
                    const httplib::Request& request,
                    httplib::Response& response) {
                    const char* requiredFields[] = {
                        "title", "artist", "duration",
                        "spotifyId", "spotifyUri", "album", "artworkUrl"};
                    for (std::size_t i = 0;
                         i < sizeof(requiredFields) / sizeof(requiredFields[0]);
                         ++i) {
                        if (!request.has_file(requiredFields[i])) {
                            sendError(response, 400,
                                      "Spotify track metadata is incomplete.");
                            return;
                        }
                    }

                    const std::string title =
                        request.get_file_value("title").content;
                    const std::string artist =
                        request.get_file_value("artist").content;
                    const std::string durationText =
                        request.get_file_value("duration").content;
                    const std::string spotifyId =
                        request.get_file_value("spotifyId").content;
                    const std::string spotifyUri =
                        request.get_file_value("spotifyUri").content;
                    const std::string album =
                        request.get_file_value("album").content;
                    const std::string artworkUrl =
                        request.get_file_value("artworkUrl").content;

                    if (!validText(title, 160) || !validText(artist, 240) ||
                        !validText(album, 240) || spotifyId.empty() ||
                        spotifyId.size() > 128 ||
                        spotifyUri != "spotify:track:" + spotifyId ||
                        artworkUrl.size() > 2048 ||
                        (artworkUrl.size() > 0 &&
                         artworkUrl.find("https://i.scdn.co/") != 0)) {
                        sendError(response, 400,
                                  "Spotify track metadata is invalid.");
                        return;
                    }
                    for (std::string::size_type i = 0; i < spotifyId.size();
                         ++i) {
                        const unsigned char character =
                            static_cast<unsigned char>(spotifyId[i]);
                        if (!std::isalnum(character)) {
                            sendError(response, 400,
                                      "Spotify track ID is invalid.");
                            return;
                        }
                    }
                    char* end = nullptr;
                    const long duration =
                        std::strtol(durationText.c_str(), &end, 10);
                    if (durationText.empty() || end == durationText.c_str() ||
                        *end != '\0' || duration < 1 || duration > 86400) {
                        sendError(response, 400,
                                  "Duration must be a whole number from 1 to 86400 seconds.");
                        return;
                    }

                    std::lock_guard<std::mutex> lock(playlistMutex);
                    for (const SongNode* song = playlist.head(); song != nullptr;
                         song = song->next) {
                        if (song->source == SongSource::Spotify &&
                            song->spotifyId == spotifyId) {
                            sendError(response, 409,
                                      "This Spotify track is already in your Sonora playlist.");
                            return;
                        }
                    }
                    const int songId = playlist.addSpotifySong(
                        title, artist, static_cast<int>(duration), spotifyId,
                        spotifyUri, album, artworkUrl);
                    sendJson(response, 201,
                             std::string("{\"song\":") +
                                 songJson(playlist.findById(songId)) + "}");
                });

    server.Delete(R"(/api/songs/?)",
                  [&playlist, &playlistMutex, &sendJson, &sendError,
                   &readJsonInteger, &playlistJson](
                      const httplib::Request& request,
                      httplib::Response& response) {
                      int songId = 0;
                      if (!readJsonInteger(request.body, "id", songId)) {
                          sendError(response, 400,
                                    "Request JSON must contain a positive integer id.");
                          return;
                      }
                      std::lock_guard<std::mutex> lock(playlistMutex);
                      if (!playlist.removeById(songId)) {
                          sendError(response, 404, "Song not found.");
                          return;
                      }
                      sendJson(response, 200,
                               std::string("{\"deleted\":true,\"playlist\":") +
                                   playlistJson() + "}");
                  });

    server.Post(R"(/api/play/?)",
                [&playlist, &playlistMutex, &sendJson, &sendError,
                 &readJsonInteger, &songJson](
                    const httplib::Request& request,
                    httplib::Response& response) {
                    int songId = 0;
                    if (!readJsonInteger(request.body, "id", songId)) {
                        sendError(response, 400,
                                  "Request JSON must contain a positive integer id.");
                        return;
                    }
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    if (!playlist.selectSong(songId)) {
                        sendError(response, 404, "Song not found.");
                        return;
                    }
                    sendJson(response, 200,
                             std::string("{\"song\":") +
                                 songJson(playlist.currentSong()) + "}");
                });

    server.Post("/api/next",
                [&playlist, &playlistMutex, &sendJson, &sendError, &songJson](
                    const httplib::Request&, httplib::Response& response) {
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    if (!playlist.advanceNext()) {
                        sendError(response, 409,
                                  playlist.isEmpty() ? "The playlist is empty."
                                                     : "Already at the last song.");
                        return;
                    }
                    sendJson(response, 200,
                             std::string("{\"song\":") +
                                 songJson(playlist.currentSong()) + "}");
                });

    server.Post("/api/previous",
                [&playlist, &playlistMutex, &sendJson, &sendError, &songJson](
                    const httplib::Request&, httplib::Response& response) {
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    if (!playlist.advancePrevious()) {
                        sendError(response, 409,
                                  playlist.isEmpty() ? "The playlist is empty."
                                                     : "Already at the first song.");
                        return;
                    }
                    sendJson(response, 200,
                             std::string("{\"song\":") +
                                 songJson(playlist.currentSong()) + "}");
                });

    server.Post("/api/shuffle",
                [&playlist, &playlistMutex, &playlistJson, &sendJson](
                    const httplib::Request&, httplib::Response& response) {
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    playlist.shuffle();
                    sendJson(response, 200, playlistJson());
                });

    server.Post("/api/reverse",
                [&playlist, &playlistMutex, &playlistJson, &sendJson](
                    const httplib::Request&, httplib::Response& response) {
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    playlist.reverse();
                    sendJson(response, 200, playlistJson());
                });

    server.Post("/api/sort",
                [&playlist, &playlistMutex, &playlistJson, &sendJson](
                    const httplib::Request&, httplib::Response& response) {
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    playlist.sortByTitle();
                    sendJson(response, 200, playlistJson());
                });

    server.Post("/api/repeat",
                [&playlist, &playlistMutex, &readJsonString, &sendJson,
                 &sendError, &playlistJson](
                    const httplib::Request& request,
                    httplib::Response& response) {
                    std::string mode;
                    if (!readJsonString(request.body, "mode", mode)) {
                        sendError(response, 400,
                                  "Repeat mode must be off, one, or all.");
                        return;
                    }
                    RepeatMode repeatMode;
                    if (mode == "off") {
                        repeatMode = RepeatMode::Off;
                    } else if (mode == "one") {
                        repeatMode = RepeatMode::One;
                    } else if (mode == "all") {
                        repeatMode = RepeatMode::All;
                    } else {
                        sendError(response, 400,
                                  "Repeat mode must be off, one, or all.");
                        return;
                    }
                    std::lock_guard<std::mutex> lock(playlistMutex);
                    playlist.setRepeatMode(repeatMode);
                    sendJson(response, 200, playlistJson());
                });

    server.Delete("/api/playlist",
                  [&playlist, &playlistMutex, &playlistJson, &sendJson](
                      const httplib::Request&, httplib::Response& response) {
                      std::lock_guard<std::mutex> lock(playlistMutex);
                      playlist.clear();
                      sendJson(response, 200, playlistJson());
                  });

    server.set_error_handler(
        [&sendError](const httplib::Request& request,
                    httplib::Response& response) {
            if (request.path.find("/api/") == 0 && response.status == 404) {
                sendError(response, 404, "API route not found.");
            } else if (request.path.find("/api/") == 0 &&
                       response.body.empty()) {
                sendError(response, response.status == 0 ? 400 : response.status,
                          "The API request could not be processed.");
            } else {
                if (response.body.empty()) {
                    response.set_content("Page not found.", "text/plain");
                }
            }
        });

    std::cout << "Spotify Client ID detected: "
              << (spotifyClientId.empty() ? "no" : "yes") << "\n"
              << "Spotify redirect URI: " << spotifyRedirectUri << "\n"
              << "Music player ready at http://127.0.0.1:"
              << PLAYLIST_WEB_SERVER_PORT << "\n"
              << "Bound to 127.0.0.1:" << PLAYLIST_WEB_SERVER_PORT
              << ". Keep this window open while "
                 "using the player.\n"
              << std::flush;
    if (!server.listen("127.0.0.1", PLAYLIST_WEB_SERVER_PORT)) {
        std::cerr << "Could not start server on 127.0.0.1:"
                  << PLAYLIST_WEB_SERVER_PORT << ". "
                  << "Check whether the port is already in use and verify "
                     "that Windows permits local connections.\n"
                  << std::flush;
        return 1;
    }
    return 0;
#else
    Playlist playlist("My Playlist");
    bool running = true;

    while (running) {
        printMenu(playlist);
        int choice = 0;
        if (!readInteger("Enter your choice (1-20): ", 1, 20, choice)) {
            std::cout << "\nInput closed. Exiting safely.\n";
            break;
        }
        if (choice == 16) {
            std::cout << "Thank you for using the Music Playlist Management System.\n";
            running = false;
        } else if (!handleChoice(playlist, choice)) {
            std::cout << "\nInput closed. Exiting safely.\n";
            running = false;
        }
    }

    return 0;
#endif
}
