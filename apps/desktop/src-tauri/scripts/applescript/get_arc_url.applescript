if application "Arc" is not running then error "Arc is not running"

tell application "Arc"
    if (count of windows) is 0 then error "Arc has no windows"
    set theUrl to URL of active tab of front window
    if theUrl is missing value or theUrl is "" then error "Arc has no active URL"
    return theUrl
end tell
