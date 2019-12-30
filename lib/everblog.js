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
    this._findNotes = Promise.promisify(this._noteStore.findNotes, { context: this._noteStore })
    this._getNoteContent = Promise.promisify(this._noteStore.getNoteContent, { context: this._noteStore })
    this._getNoteTagNames = Promise.promisify(this._noteStore.getNoteTagNames, { context: this._noteStore })
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

  * findNotes(_notebookGuid, _filter, _offset, _maxNotes, _notes) {
    _notebookGuid = _notebookGuid || (yield this.getNotebook()).guid
    _filter       = _filter || new Evernote.NoteFilter({ notebookGuid: _notebookGuid })
    _offset       = _offset || 0
    _maxNotes     = _maxNotes || 50
    _notes        = _notes || []

    let notes = (yield this._findNotes(_filter, _offset, _maxNotes)).notes
    var cloudNoteNames = []
    notes = yield notes.map(function* (note) {
      // get all note names on the cloud
      if (note.title.trim() !== '_config.yml') {
        cloudNoteNames.push(note.title.trim())
      }
      var filePath = 'source/_posts/' + note.title.trim() + '.html'
      var existing = fs.existsSync(filePath)
      // no update from last everblog build
      if (note.updated < this._options.lastBuild && existing) {
        return undefined
      }
      note.content = yield this._getNoteContent(note.guid)
      // not share _config.yml
      if (note.title.trim() !== '_config.yml') {
        note.noteKey = yield this.getNoteKey(note.guid)
      }
      if (note.tagGuids) {
        note.tags = yield this._getNoteTagNames(note.guid)
      } else {
        note.tags = []
      }
      return note
    }, this)

    // clean deleted notes
    var fileNames = fs.readdirSync('source/_posts/')
    fileNames.forEach(function(fileName){
      if (fileName[0] !== '.' && !cloudNoteNames.includes(fileName.slice(0, -5))) {
        removeDir('source/images/' + fileName.slice(0, -5))
        debug('delete -> %s', 'source/images/' + fileName.slice(0, -5))
        fs.unlinkSync('source/_posts/' + fileName)
        debug('delete -> %s', 'source/_posts/' + fileName)
      }
    });

    // filter out all undefined members
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