import React, { Component } from 'react';

import LinkButton from './LinkButton'
import { v4, v5 } from 'uuid'

import { LazyLoadImage } from 'react-lazy-load-image-component';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

export default class DisplayWorkspace extends Component {
    render() {
        const hashedurl = v5(this.props.url, '1b671a64-40d5-491e-99b0-d37347111f20')

        const showUrl = this.props.settings.showUrl === true ? (
          <a href={this.props.url} target="_blank" className="URL" key={`showurl-${hashedurl}`}>
            {this.props.url}
          </a>
        ) : null

        const links = []
        for (const key in this.props.settings.openManifestLinks) {
          const link = Object.assign({}, this.props.settings.openManifestLinks[key])
          if (link.tabWorkspaces) {
            const bgcolor = link.backgroundColor === undefined ? false : link.backgroundColor
            links.push(
              <LinkButton
                tooltiptitle="Open Manifest"
                lang="en"
                bgcolor={bgcolor}
                link={link}
                theme={this.props.theme}
                uri={this.props.url}
                key={`linkbutton-${v5(JSON.stringify(link),'1b671a64-40d5-491e-99b0-d37347111f20')}-${hashedurl}`}
              />
            )
          }
        }

        const buttons = []
        if (this.props.theme.generalButtons.removeFromWorkspace !== false) {
          buttons.push(
            <Tooltip title="Remove manifest" describeChild key={v4()} >{
              this.props.theme.trashcanImage ?
                <IconButton color="primary" aria-label="Remove from workspace" component="span" onClick={() => this.props.removeFromWorkspace(this.props.id)} key={`rembutton-${hashedurl}`} >
                  <img src={this.props.theme.trashcanImage}  className="iconSize" />
                </IconButton>
                :
                <button onClick={() => this.props.removeFromWorkspace(this.props.id)} className="ButtonRemoveFromWorkspace" key={`rembutton-${hashedurl}`} >
                  Remove from workspace
                </button>}
            </Tooltip>
          )
        }

        return (
          <div className="ListItem" key={`listitem-${hashedurl}`}>
            <div className="ListItem-image" key={`listitem-image-${hashedurl}`}>
              <LazyLoadImage
                src={this.props.thumb}
                placeholder=<HourglassEmptyIcon sx={{color:'white'}}
                key={`listitem-lazyimage-${hashedurl}`} />
              />
            </div>
            <div className="ListItem-info" key={`listitem-info-${hashedurl}`}>
              <span className="truncated" key={`listitem-info-label-${hashedurl}`}>
                {this.props.label}
              </span>
              <span className="truncated" key={`listitem-info-url-${hashedurl}`}>
                {showUrl}<br />
              </span>
              {links}<br />
              {buttons}<br />
            </div>
          </div>
        )
    }
}
