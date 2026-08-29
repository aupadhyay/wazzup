if application "Dia" is not running then error "Dia is not running"

tell application "Dia"
    if (count of windows) is 0 then error "Dia has no windows"
    set theUrl to URL of active tab of window 1
    if theUrl is missing value or theUrl is "" then error "Dia has no active URL"
    return theUrl
end tell
