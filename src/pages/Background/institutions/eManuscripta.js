export default {
  name: 'e-manuscripta',
  shouldFetchBodyAfterHead(url, status) {
    return status === 500 && (
      /^https:\/\/www\.e-manuscripta\.ch\//i.test(url) ||
      /^https:\/\/emanus\.rc\.vls\.io/i.test(url)
    )
  }
}
