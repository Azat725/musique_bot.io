# Sound credits

All recordings are by **Joseph Sardin** (the car ones with Axeline T. where marked), [BigSoundBank](https://bigsoundbank.com/),
released under **CC0** (public domain). No attribution is required, but it is given here with thanks.

## The tape deck

| File | Source recording |
|---|---|
| `tape-play.mp3`, `tape-pause.mp3` | [Cassette Player: Play and Pause](https://bigsoundbank.com/cassette-player-play-and-pause-s0570.html) (#570) |
| `tape-stop.mp3` | [Cassette Player: Rewind and Stop](https://bigsoundbank.com/cassette-player-rewind-and-stop-s0566.html) (#566) |
| `tape-eject.mp3`, `tape-insert.mp3` | [Cassette Player: Cassette](https://bigsoundbank.com/cassette-player-cassette-s0571.html) (#571) |

Cut, peak-normalised and encoded as mono MP3 at 64 kbit/s. The tape hiss and the winding sound are synthesised in
`js/sfx.js`.

## The record player

`needle.mp3` and `swipe.mp3` are also short cuts from BigSoundBank recordings by Joseph Sardin under CC0; the exact
recording pages were not noted when they were added.

## The car radio and the driving game

Loops cut from the recordings below (mono MP3, 56–64 kbit/s). Each loop is made seamless: its last two seconds are
crossfaded into its first two, and the level is normalised with ffmpeg. They are fetched only when the car radio or the
game starts, and only with the sounds on; until they arrive, the synthesised sounds in `js/sfx.js` play.

| File | Seconds used | Source recording |
|---|---|---|
| `car-rain-glass.mp3` | 14–50 of 53 | [Thunder and rain on car windshield](https://bigsoundbank.com/storm-and-rain-on-car-windshield-s1296.html) (#1296), the steady rain after the thunder |
| `car-rain-roof.mp3` | 8–44 of 110 | [Rain on car roof](https://bigsoundbank.com/rain-on-car-roof-s1293.html) (#1293) |
| `car-road.mp3` | 50–78 of 241 | [Car interior, 50 km/h](https://bigsoundbank.com/car-interior-50-km-h-s3099.html) (#3099, with Axeline T.), a Citroën C3 in the city |
| `car-engine.mp3` | 6–25.5 of 34 | [Cars (Interior, off)](https://bigsoundbank.com/cars-interior-off-s0557.html) (#557), the engine idling between starting and stopping |
| `car-pass.mp3` | 3–14 of 16 | [4 cars passing at 90 km/h](https://bigsoundbank.com/4-cars-passing-at-90-km-h-s3434.html) (#3434, with Axeline T.), one shot |
| `car-horn.mp3` | 2.35–3.05 of 10.5 | [Klaxons, inside car](https://bigsoundbank.com/klaxons-inside-car-s0558.html) (#558), one honk; the game loops its sustain while the horn is held |
