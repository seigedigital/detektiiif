function normalizeWorkspaceLink(link) {
  if (!link) {
    return link;
  }

  const nextLink = { ...link };
  if (nextLink.tabWorkspaces === undefined && nextLink.tabBasket !== undefined) {
    nextLink.tabWorkspaces = nextLink.tabBasket;
  }
  delete nextLink.tabBasket;

  return nextLink;
}

function normalizeWorkspaceLinks(links) {
  const normalized = {};

  Object.keys(links || {}).forEach((key) => {
    normalized[key] = normalizeWorkspaceLink(links[key]);
  });

  return normalized;
}

export {
  normalizeWorkspaceLink,
  normalizeWorkspaceLinks,
};
