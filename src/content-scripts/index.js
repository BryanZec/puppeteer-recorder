import eventsToRecord from '../code-generator/dom-events-to-record'
import elementsToBindTo from '../code-generator/elements-to-bind-to'
import finder from '@medv/finder'

class EventRecorder {
  constructor () {
    this.eventLog = []
    this.previousEvent = null
  }

  start () {
    chrome.storage.local.get(['options'], ({ options }) => {
      const {dataAttribute, useRegexForDataAttribute} = options ? options.code : {}
      if (dataAttribute) {
        this.dataAttributes = dataAttribute.split(' ').filter(f => f !== '').map(f => {
          if (useRegexForDataAttribute) {
            return new RegExp(f)
          } else {
            return f
          }
        })
      }

      this.useRegexForDataAttribute = useRegexForDataAttribute

      const events = Object.values(eventsToRecord)
      if (!window.pptRecorderAddedControlListeners) {
        this.addAllListeners(elementsToBindTo, events)
        window.pptRecorderAddedControlListeners = true
      }

      if (!window.document.pptRecorderAddedControlListeners && chrome.runtime && chrome.runtime.onMessage) {
        const boundedGetCurrentUrl = this.getCurrentUrl.bind(this)
        const boundedGetViewPortSize = this.getViewPortSize.bind(this)
        chrome.runtime.onMessage.addListener(boundedGetCurrentUrl)
        chrome.runtime.onMessage.addListener(boundedGetViewPortSize)
        window.document.pptRecorderAddedControlListeners = true
      }

      const msg = { control: 'event-recorder-started' }
      this.sendMessage(msg)
      console.debug('Puppeteer Recorder in-page EventRecorder started')
    })
  }

  addAllListeners (elements, events) {
    const boundedRecordEvent = this.recordEvent.bind(this)
    events.forEach(type => {
      window.addEventListener(type, boundedRecordEvent, true)
    })
  }

  sendMessage (msg) {
    console.debug('sending message', msg)
    try {
      // poor man's way of detecting whether this script was injected by an actual extension, or is loaded for
      // testing purposes
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.sendMessage(msg)
      } else {
        this.eventLog.push(msg)
      }
    } catch (err) {
      console.debug('caught error', err)
    }
  }

  getCurrentUrl (msg) {
    if (msg.control && msg.control === 'get-current-url') {
      console.debug('sending current url:', window.location.href)
      this.sendMessage({ control: msg.control, href: window.location.href })
    }
  }

  getViewPortSize (msg) {
    if (msg.control && msg.control === 'get-viewport-size') {
      console.debug('sending current viewport size')
      this.sendMessage({ control: msg.control, coordinates: { width: window.innerWidth, height: window.innerHeight } })
    }
  }

  recordEvent (e) {
    if (this.previousEvent && this.previousEvent.timeStamp === e.timeStamp) return
    this.previousEvent = e
    let customAttribute = null
    if (this.dataAttributes && this.dataAttributes.length && e.target.hasAttribute) {
      // We search custom attribute
      const targetAttributes = e.target.attributes

      // Order of patterns is important
      this.dataAttributes.find(patternAttr => {
        // We test each target attribute with pattern
        for (let i = 0; i < targetAttributes.length; i++) {
          // Regex or string test
          if (this.useRegexForDataAttribute ? patternAttr.test(targetAttributes[i].name) : patternAttr === targetAttributes[i].name) {
            customAttribute = targetAttributes[i].name
            // The search is finish
            return true
          }
        }

        return false
      })
    }

    const selector = customAttribute
      ? formatDataSelector(e.target, customAttribute)
      : finder(e.target, { seedMinLength: 5, optimizedMinLength: 10 })

    let comments = ''
    // We need to check if the selector is ambiguous...
    if (customAttribute && document.querySelectorAll(selector).length > 1) {
      // More than one element, so the test will be wrong.
      comments = '/!\\ The selector returns more than one element, thus the test will be wrong.'
    }

    const msg = {
      selector: selector,
      comments,
      value: e.target.value,
      tagName: e.target.tagName,
      action: e.type,
      keyCode: e.keyCode ? e.keyCode : null,
      href: e.target.href ? e.target.href : null,
      coordinates: getCoordinates(e)
    }
    this.sendMessage(msg)
  }

  getEventLog () {
    return this.eventLog
  }

  clearEventLog () {
    this.eventLog = []
  }
}

function getCoordinates (evt) {
  const eventsWithCoordinates = {
    mouseup: true,
    mousedown: true,
    mousemove: true,
    mouseover: true
  }
  return eventsWithCoordinates[evt.type] ? { x: evt.clientX, y: evt.clientY } : null
}

function formatDataSelector (element, attribute) {
  return `[${attribute}="${element.getAttribute(attribute)}"]`.replace(/\./g, '\\.')
}

window.eventRecorder = new EventRecorder()
window.eventRecorder.start()
