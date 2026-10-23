// Encrypted Access files are not supported here; the machine settings files are not encrypted.
export default { createDecipheriv() { throw new Error('Encrypted database files are not supported.'); } };
