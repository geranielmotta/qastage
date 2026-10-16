# language: pt
Funcionalidade: Cadastro de clientes pela API

  # A fonte dos endpoints vem do qastage.config.json do projeto (plugins.api-testing.spec).
  # Um .feature pode apontar outra: Dado que a API é descrita em "<link ou arquivo do projeto>".
  # Segredos podem vir do .env: | senha | ${DEMO_API_SENHA} |
  Contexto:
    Dado que eu faço login em "POST /auth/login" com:
      | email | qa@empresa.com |
      | senha | segredo        |

  Cenário: Cadastrar cliente com dados gerados pelo schema
    Quando eu envio "POST /clientes"
    Então a resposta deve ter status 201
    E a resposta deve seguir o contrato
    E eu guardo o campo "id" da resposta como "id"
    Quando eu envio "GET /clientes/{id}"
    Então a resposta deve ter status 200
    E o campo "id" da resposta deve ser "{{id}}"

  Cenário: Cadastrar cliente com dados específicos
    Quando eu envio "POST /clientes" com:
      | nome          | Maria Teste |
      | tipo          | PJ          |
      | limiteCredito | 1500        |
    Então a resposta deve ter status 201
    E o campo "nome" da resposta deve ser "Maria Teste"
    E o campo "limiteCredito" da resposta deve ser "1500"

  Cenário: CPF inválido é recusado conforme o contrato
    Quando eu envio "POST /clientes" com:
      | cpf | 12345678900 |
    Então a resposta deve ter status 400
    E a resposta deve seguir o contrato
    E o campo "campo" da resposta deve ser "cpf"

  Cenário: Tipos errados são recusados
    Então os tipos dos campos de "POST /clientes" devem ser validados

  Cenário: Sem token não entra
    Dado que eu não estou autenticado
    Quando eu envio "GET /clientes"
    Então a resposta deve ter status 401
    E a resposta deve seguir o contrato
