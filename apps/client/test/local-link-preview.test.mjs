import test from 'node:test'
import assert from 'node:assert/strict'
import {localLinkPreview} from '../src/local-link-preview.ts'
test('automatic cards parse the first safe link without metadata requests',()=>{
  assert.deepEqual(localLinkPreview('See (https://example.com/path).'),{url:'https://example.com/path',title:'example.com',description:''})
  assert.equal(localLinkPreview('unfinished https://'),null)
  assert.equal(localLinkPreview('javascript:alert(1)'),null)
  assert.equal(localLinkPreview('https://user:secret@example.com/path'),null)
  assert.equal(localLinkPreview('https://user:secret@example.com https://safe.example/a_(b)').url,'https://safe.example/a_(b)')
})
