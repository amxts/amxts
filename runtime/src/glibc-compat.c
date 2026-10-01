// What the network libraries take from glibc 2.25 - explicit_bzero, which
// curl, mbedTLS and libssh2 call when the headers they are built against have
// it, and the _FORTIFY_SOURCE check of it - defined in the module itself, so
// the Linux module still loads on a glibc from 2.17. Linux only.
#include <stddef.h>

void explicit_bzero(void *buffer, size_t length)
{
	volatile unsigned char *at = (volatile unsigned char *)buffer;
	while (length--)
		*at++ = 0;
}

void __explicit_bzero_chk(void *buffer, size_t length, size_t size)
{
	(void)size;
	explicit_bzero(buffer, length);
}
