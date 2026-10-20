import React, { Component } from 'react'

import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import Defaults from '../../../themes/active/Defaults.js'

import { normalizeIgnoreDomains } from '../../../shared/ignoredDomains'

class IgnoreDomains extends Component {

  constructor(props) {
    super()

    this.defaults = new Defaults()
    this.defaultIgnoreDomains = normalizeIgnoreDomains(this.defaults.ignoreDomains)

    this.upd = this.upd.bind(this)
    this.handleStorageChange = this.handleStorageChange.bind(this)
    this.handleTextChange = this.handleTextChange.bind(this)
    this.resetDefaults = this.resetDefaults.bind(this)

    this.state = {
      domainText: this.defaultIgnoreDomains.join('\n'),
      ignoreDomains: this.defaultIgnoreDomains
    }

    chrome.storage.local.get('ignoreDomains', (data) => {
      if(data.ignoreDomains!==undefined) {
        this.setDomains(data.ignoreDomains)
      } else {
        this.setDomains(this.defaultIgnoreDomains)
      }
    })

    chrome.storage.onChanged.addListener(this.handleStorageChange)

  }

  componentWillUnmount() {
    chrome.storage.onChanged.removeListener(this.handleStorageChange)
  }

  setDomains(domains) {
    const ignoreDomains = normalizeIgnoreDomains(domains)

    this.setState({
      domainText: ignoreDomains.join('\n'),
      ignoreDomains,
    })
  }

  upd() {
    chrome.storage.local.set({ignoreDomains:this.state.ignoreDomains})
  }

  handleStorageChange(changes, namespace) {
    if(namespace !== "local" || !changes.ignoreDomains) {
      return
    }

    const ignoreDomains = normalizeIgnoreDomains(changes.ignoreDomains.newValue)

    if(JSON.stringify(ignoreDomains) !== JSON.stringify(this.state.ignoreDomains)) {
      this.setState({
        domainText: ignoreDomains.join('\n'),
        ignoreDomains,
      })
    }
  }

  handleTextChange(event) {
    this.setState({
      domainText: event.target.value,
      ignoreDomains: normalizeIgnoreDomains(event.target.value),
    }, this.upd)
  }

  resetDefaults() {
    this.setState({
      domainText: this.defaultIgnoreDomains.join('\n'),
      ignoreDomains: this.defaultIgnoreDomains,
    }, this.upd)
  }

  render() {

    return (

        <span>
          <h3>Exclude Domains</h3>
          <TextField
            id="ignore-domains"
            label="Excluded domains"
            multiline
            maxRows={10}
            minRows={6}
            placeholder="one domain per line"
            variant="outlined"
            value={this.state.domainText}
            style={{marginLeft:0,width:"90%"}}
            onChange={this.handleTextChange}
          />
          <br />
          <br />
          <Button variant="outlined" size="small" color="error"
            onClick={this.resetDefaults}
          >
            Reset Defaults
          </Button>
        </span>
    )
  }

}


export default IgnoreDomains
