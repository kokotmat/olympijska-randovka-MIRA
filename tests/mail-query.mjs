import assert from 'node:assert/strict';
import {sponsorMailQuery} from '../sprava/mail-query.js';
assert.equal(sponsorMailQuery(' INFO@EXAMPLE.CZ '),'{from:"info@example.cz" to:"info@example.cz"}');
for(const value of ['a@example.cz OR in:anywhere','a@example.cz"','a@example.cz\nother@example.cz','javascript:alert(1)','',null,'x'.repeat(81)+'@example.cz'])assert.equal(sponsorMailQuery(value),null);
assert.ok(sponsorMailQuery('name+tag@example.cz').length<=200);
console.log('PASS sponsor address search stays literal and bounded');
