// Only a single literal address is allowed in the generated Gmail query.
// This is a search aid, not confirmation that every match belongs to a sponsor.
export function sponsorMailQuery(email){
 const value=String(email||'').trim().toLowerCase();
 if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value)||value.length>80)return null;
 return '{from:"'+value+'" to:"'+value+'"}';
}
