-- Tiny bridge for the office worker: drive ONE tab in Phuong's own Chrome.
-- usage: osascript chrome.applescript <cmd> [tabId] [arg]
on run argv
	set cmd to item 1 of argv
	tell application "Google Chrome"
		if cmd is "new" then
			set w to make new window
			set bounds of w to {40, 60, 1240, 860}
			set URL of active tab of w to (item 2 of argv)
			return (id of active tab of w) as text
		end if
		set tid to (item 2 of argv) as integer
		set target to missing value
		repeat with w in windows
			try
				set target to (first tab of w whose id is tid)
				exit repeat
			end try
		end repeat
		if target is missing value then return "NOTAB"
		if cmd is "exists" then return "OK"
		if cmd is "state" then return (URL of target) & "|" & (loading of target as text)
		if cmd is "go" then
			set URL of target to (item 3 of argv)
			return "OK"
		end if
		if cmd is "js" then return (execute target javascript (item 3 of argv)) as text
		if cmd is "close" then
			close target
			return "OK"
		end if
	end tell
	return "BADCMD"
end run
