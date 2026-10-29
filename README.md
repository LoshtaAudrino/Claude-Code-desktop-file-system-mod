# Commander

A Norton Commander style file tree pane for Claude Code Desktop (Windows).

- Navy theme with Name / Size / Date columns, tree lines, folder and file icons, and an F-key bar.
- Click a folder to expand or collapse it. Click a file to select it, click again to reveal it in Explorer.
- When Claude writes or edits a file, its folders expand and the file is selected, so deep prototype folders need no hunting.
- Buttons: Show (reveal in Explorer), Enter (make the selected folder the root), CopyPath, Close.
- Shortcut tabs for drives and project folders are set in `hooks/register.tsx` (`SHORTCUTS`). Edit them to match your machine.

## Install

Put the folder in your Claude Code mods folder or load it with `claude --plugin-dir <this folder>`. Then open the pane with `/nc`.

## Notes

Revealing a file uses the app's `reveal_path` tool, which asks for approval on Windows each time. Tested only on Claude Code Desktop for Windows.

## License

CC0 1.0. Use, modify, share. No attribution needed.
