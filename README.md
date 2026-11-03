# Music Playlist Management System Using Linked List

A menu-driven C++ console application for managing and navigating a music
playlist. It demonstrates a manually implemented doubly linked list, dynamic
memory allocation, searching, insertion, deletion, sorting, reversing, and
playback navigation. Playback is simulated; the program does not play audio.

## Objectives

- Apply linked-list concepts to a practical playlist-management problem.
- Practice node creation, pointer updates, traversal, searching, and deletion.
- Safely manage playback state when the current song or playlist changes.
- Compare the time cost of common linked-list operations.

## Project structure

```text
MusicPlaylistManagementSystem/
├── main.cpp                 # SongNode, Playlist, input helpers, and console UI
├── README.md                # Design, algorithms, complexity, and instructions
└── sample_test_cases.txt    # Reproducible manual test scenarios
```

## Features

- Create a new named playlist; add songs at the end or at a selected position.
- Remove all songs matching a title, or remove one song by position.
- Display the playlist in forward or backward order.
- Search titles and artists (case-insensitive substring matching).
- Play the first/current, next, previous, or a song at a selected position.
- Shuffle, alphabetically sort, and reverse the playlist.
- Repeat the current song or entire playlist, or turn repeat off.
- Display songs by artist, count songs, and clear the playlist.
- Validate menu choices, positions, durations, titles, and artist names.
- Handle empty/single-song playlists and deletion of the current song safely.

## Technologies used

- C++11 or later
- Standard C++ library for console I/O, strings, formatting, and random numbers.
- A manually implemented doubly linked list. No STL container is used to store
  the playlist.

## Data structure explanation

Each `SongNode` stores a unique ID, title, artist, duration in seconds, and
`next`/`previous` pointers. `Playlist` owns all nodes and maintains `head`,
`tail`, `current`, and song count. The first and last nodes have null pointers
outside the list. The playlist destructor and `clear()` delete every allocated
node.

### How the doubly linked list is used

- **Forward traversal:** starts at `head` and follows `next` to display and
  search the playlist.
- **Backward traversal:** starts at `tail` and follows `previous`.
- **Insertion:** connects a new node to its predecessor and successor, updating
  `head` or `tail` when insertion is at a boundary.
- **Deletion:** reconnects neighboring nodes before deleting the selected node.
  If the current song is deleted, playback moves to its successor, or to its
  predecessor if there is no successor.
- **Navigation:** `next` and `previous` links allow moving between tracks
  without rebuilding the list. Repeat-all wraps at either end; repeat-one
  retains the current node.
- **Reversal:** swaps both links on every node, then swaps `head` and `tail`.
- **Shuffle:** uses Fisher-Yates on a temporary dynamically allocated array of
  node pointers, then relinks those same nodes. The linked list remains the
  playlist's only storage structure, and the current node identity is retained.
- **Sorting:** a stable merge sort rearranges nodes by case-insensitive title
  (then artist and ID), and reconstructs the backward links.

## Algorithm descriptions

1. **Insert at position:** validate the 1-based position, find the node at that
   position (or append), then update both neighboring links and boundary
   pointers.
2. **Delete by position/title:** locate the node, reconnect its neighbors,
   repair the current-song pointer if needed, and free the removed node. Title
   deletion removes the first exact case-insensitive match.
3. **Search:** scan from head to tail and compare case-insensitively. Title and
   artist searches accept partial matches; title deletion requires an exact
   case-insensitive match and removes only the first matching song.
4. **Shuffle:** Fisher-Yates randomly permutes node pointers in a temporary
   array, then reconnects the nodes in that order.
5. **Sort:** merge sort divides the linked sequence into halves and merges them
   in alphabetical order without copying song data.
6. **Reverse:** swap `next` and `previous` for every node and exchange the head
   and tail pointers.

## Time complexity

Let `n` be the number of songs. Position-based lookup traverses from whichever
end is closer.

| Operation | Time | Extra space |
|---|---:|---:|
| Add at end | O(1) | O(1) |
| Insert at beginning/end | O(1) | O(1) |
| Insert at arbitrary position | O(n) | O(1) |
| Delete at beginning/end (after locating) | O(1) | O(1) |
| Delete by position | O(n) | O(1) |
| Delete by title | O(n) | O(1) |
| Display/traverse/search | O(n) | O(1) |
| Play next/previous | O(1) | O(1) |
| Play by position | O(n) | O(1) |
| Reverse | O(n) | O(1) |
| Shuffle | O(n) expected | O(n) temporary pointers |
| Sort by title (merge sort) | O(n log n) | O(log n) recursion |
| Clear playlist | O(n) | O(1) |

## Compile and run

From the project directory, compile with a standard C++ compiler:

```bash
g++ -std=c++11 -Wall -Wextra -pedantic main.cpp -o playlist
./playlist
```

On Windows with MinGW:

```powershell
g++ -std=c++11 -Wall -Wextra -pedantic main.cpp -o playlist.exe
.\playlist.exe
```

Choose **17. Create New Playlist** to name or replace the active playlist.
Choose **20. Play First Song** to return playback to the head node. Durations
are entered in seconds and displayed as `minutes:seconds`.

## Sample output

```text
========== Music Playlist Management System ==========
Playlist: My Playlist | Songs: 0
1.  Add Song
...
Enter your choice (1-19): 1
Song title: Blue in Green
Artist name: Miles Davis
Duration in seconds (1-86400): 337
Song added to the end of the playlist.

Enter your choice (1-20): 6
Now playing (simulated): Blue in Green - Miles Davis (5:37)
```

Additional input/output scenarios are in `sample_test_cases.txt`.

## Future enhancements

- Persist playlists to a file or database.
- Support multiple playlists and moving/copying songs between them.
- Integrate an audio playback library and richer playback controls.
- Add duration parsing (`mm:ss`), playlists imported from files, and metadata
  validation.
- Add automated unit tests and a graphical interface.
