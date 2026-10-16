# language: pt
Funcionalidade: Pico de cadastros (demonstra limite reprovado)

  Contexto:
    Dado que a API é descrita em "examples/api-demo/openapi.json"
    E que eu faço login em "POST /auth/login" com:
      | email | qa@empresa.com |
      | senha | segredo        |

  # Muitos cadastros deixam a listagem lenta (a demo não tem índice):
  # o limite da listagem deve reprovar.
  Cenário: Pico de cadastros com listagem
    Dado a carga sobe até 20 usuários em "3s" e se mantém por "7s"
    E cada usuário espera "100ms" entre as requisições
    E cada usuário executa:
      | endpoint       | peso |
      | POST /clientes | 3    |
      | GET /clientes  | 1    |
    Então o p95 de "GET /clientes" deve ser menor que 100 ms
    E a taxa de erro deve ser menor que "1%"
