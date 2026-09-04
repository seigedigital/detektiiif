export default {
  name: 'e-rara',
  shouldFetchBodyAfterHead(url, status) {
    return status === 500 && /^https:\/\/www\.e-rara\.ch\//i.test(url)
  }
}
