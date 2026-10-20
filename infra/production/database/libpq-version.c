#include <stdio.h>
#include <string.h>
#include <libpq-fe.h>
#include <openssl/crypto.h>

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "openssl") == 0)
    {
        puts(OpenSSL_version(OPENSSL_VERSION));
        return 0;
    }
    printf("%d\n", PQlibVersion());
    return 0;
}
