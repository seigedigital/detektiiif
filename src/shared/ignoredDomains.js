function getInputParts(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return String(value || '').split(/[\n,]+/);
}

function normalizeIgnoreDomain(value) {
  const trimmed = String(value || '').trim().toLowerCase();

  if (!trimmed) {
    return '';
  }

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname.replace(/^\.+|\.+$/g, '');
    }
  } catch {
    return '';
  }

  return trimmed
    .split(/[/?#]/)[0]
    .replace(/:\d+$/g, '')
    .replace(/^\.+|\.+$/g, '');
}

function normalizeIgnoreDomains(value) {
  const seen = new Set();
  const domains = [];

  getInputParts(value).forEach((part) => {
    const domain = normalizeIgnoreDomain(part);

    if (domain && !seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
  });

  return domains;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/g, '');
  } catch {
    return '';
  }
}

function hostnameMatchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isUrlIgnoredByDomainList(url, domains) {
  const hostname = getHostname(url);

  if (!hostname) {
    return false;
  }

  return normalizeIgnoreDomains(domains).some((domain) => (
    hostnameMatchesDomain(hostname, domain)
  ));
}

export {
  isUrlIgnoredByDomainList,
  normalizeIgnoreDomain,
  normalizeIgnoreDomains,
};
