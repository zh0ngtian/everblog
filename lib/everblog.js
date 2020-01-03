'use strict';

const Promise = require('bluebird')
const Evernote = require('evernote').Evernote
const debug = require('debug')('everblog')
const path = require('path')
const fs = require('fs')

module.exports = class EverblogCore {

  constructor(options) {
    options.sandbox = options.sandbox || !!options.noteStoreUrl.match(/sandbox/)

    this._options = options
    this._client = new Evernote.Client(options)
    this._noteStore = this._client.getNoteStore(options.noteStoreUrl)
    this._userStore = this._client.getUserStore()
    this._listNotebooks = Promise.promisify(this._noteStore.listNotebooks, { context: this._noteStore })
    this._listTags = Promise.promisify(this._noteStore.listTags, { context: this._noteStore })
    this._findNotes = Promise.promisify(this._noteStore.findNotes, { context: this._noteStore })
    this._getNoteContent = Promise.promisify(this._noteStore.getNoteContent, { context: this._noteStore })
    this._getNoteTagNames = Promise.promisify(this._noteStore.getNoteTagNames, { context: this._noteStore })
    this._getNotebook = Promise.promisify(this._noteStore.getNotebook, { context: this._noteStore })
    this._getUser = Promise.promisify(this._userStore.getUser, { context: this._userStore })
    this._getPublicUserInfo = Promise.promisify(this._userStore.getPublicUserInfo, { context: this._userStore })
    this._shareNote = Promise.promisify(this._noteStore.shareNote, { context: this._userStore })
  }

  * getNotebook() {
    const notebooks = yield this._listNotebooks()
    for (let notebook of notebooks) {
      if (notebook.name === this._options.notebook) {
        debug('getNotebook -> %s', notebook.name)
        return notebook
      }
    }
    throw new Error('Cannot find notebook "' + this._options.notebook + '"')
  }

  * getTag() {
    const targetTag = 'published'
    const tags = yield this._listTags()
    for (let tag of tags) {
      if (tag.name === targetTag) {
        debug('getTag -> %s', targetTag)
        return tag
      }
    }
    throw new Error('Cannot find tag "' + targetTag + '"')
  }

  * findNotes(_notebookGuid, _filter, _offset, _maxNotes, _notes) {
    _notebookGuid = _notebookGuid || ''
    _filter       = _filter || new Evernote.NoteFilter({ tagGuids: [(yield this.getTag()).guid] })
    _offset       = _offset || 0
    _maxNotes     = _maxNotes || 50
    _notes        = _notes || []

    let notes = (yield this._findNotes(_filter, _offset, _maxNotes)).notes
    let targetFileNames = []
    notes = yield notes.map(function* (note) {
      let noteName = note.title.trim()
      let notebookName = (yield this._getNotebook(note.notebookGuid)).name
      let targetFileName = notebookName + '@' + noteName + '.html'
      targetFileNames.push(targetFileName)

      let filePath = 'source/_posts/' + targetFileName
      if (note.updated < this._options.lastBuild && fs.existsSync(filePath)) {
        return undefined
      }

      note.content = yield this._getNoteContent(note.guid)
      note.noteKey = yield this.getNoteKey(note.guid)
      note.tags = [notebookName]

      return note
    }, this)

    if (fs.existsSync('source/_posts/')) {
      let existingFileNames = fs.readdirSync('source/_posts/')
      for (let existingFileName of existingFileNames) {
        if (existingFileName[0] !== '.' && !targetFileNames.includes(existingFileName)) {
          fs.unlinkSync('source/_posts/' + existingFileName)
          debug('delete -> %s', 'source/_posts/' + existingFileName)
        }
      }
    }
    if (fs.existsSync('source/images/')) {
      let existingFolderNames = fs.readdirSync('source/images/')
      for (let existingFolderName of existingFolderNames) {
        if (existingFolderName[0] !== '.' && !targetFileNames.includes(existingFolderName + '.html')) {
          removeDir('source/images/' + existingFolderName)
          debug('delete -> %s', 'source/images/' + existingFolderName)
        }
      }
    }

    notes = notes.filter((note) => {return note})

    _notes = _notes.concat(notes)
    _offset = _offset + _maxNotes

    return notes.length === _maxNotes
      ? (yield this.findNotes(_notebookGuid, _filter, _offset, _maxNotes, _notes))
      : (debug('findNotes -> %s', _notes.length), _notes)
  }

  * getWebApiUrlPrefix() {
    let username = (yield this._getUser()).username
    let webApiUrlPrefix = (yield this._getPublicUserInfo(username)).webApiUrlPrefix
    return webApiUrlPrefix
  }

  * getNoteKey(noteGuid) {
    return (yield this._shareNote(noteGuid)).slice(0, 16)
  }
}

function removeDir(dir) {
  let files = fs.readdirSync(dir)
  for(var i = 0; i < files.length; i++){
    let newPath = path.join(dir,files[i])
    let stat = fs.statSync(newPath)
    if (stat.isDirectory()) {
      removeDir(newPath)
    } else {
      fs.unlinkSync(newPath)
    }
  }
  fs.rmdirSync(dir)
}
