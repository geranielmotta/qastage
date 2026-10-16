# language: pt
Funcionalidade: Bugs plantados na API de demo (os testes devem achar)

  Contexto:
    Dado que a API é descrita em "examples/api-demo/openapi.json"
    E que eu faço login em "POST /auth/login" com:
      | email | qa@empresa.com |
      | senha | segredo        |

  Cenário: Todos os campos obrigatórios são exigidos
    Então os campos obrigatórios de "POST /clientes" devem ser exigidos

  Cenário: Busca por id respeita o contrato
    Quando eu envio "POST /clientes" com:
      | telefone | 11987654321 |
    E eu guardo o campo "id" da resposta como "id"
    E eu envio "GET /clientes/{id}"
    Então a resposta deve ter status 200
    E a resposta deve seguir o contrato
