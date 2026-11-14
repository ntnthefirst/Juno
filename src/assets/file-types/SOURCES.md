# File type icons

Shown only to say what kind of file something is: a document, a mail
attachment, a project file, the preview header. They are the "vivid" set of
file-icon-vectors, copied unchanged.

| | |
| --- | --- |
| Set | file-icon-vectors, "vivid" |
| Version | 1.0.0 (npm: `npm pack file-icon-vectors`, `dist/icons/vivid/`) |
| Source | https://github.com/dmhendricks/file-icon-vectors |
| Licence | MIT, notice below |
| Author | Daniel M. Hendricks and the set's contributors |

Fetched on 2026-11-14. Each file was checked before it was added: no script,
event handler, external reference, image or foreign object, only `path`,
`circle` and one `style` rule of fills.

The extension in a file name is the icon that type gets. `image.svg` is the
set's generic picture and `blank.svg` its generic page, used when a type has
no icon of its own. The set has none for Numbers, OpenDocument presentations
or messages, so `src/lib/file-type-icon.ts` sends them to the nearest family
or the blank page.

## Licence

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
