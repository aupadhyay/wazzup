if application "Spotify" is not running then error "Spotify is not running"

tell application "Spotify"
    if player state is playing then
        set currentTrack to the current track
        return "{\"artist\": \"" & artist of currentTrack & "\", \"track\": \"" & name of currentTrack & "\"}"
    else
        return "{\"artist\": \"Not playing\", \"track\": \"Not playing\"}"
    end if
end tell 