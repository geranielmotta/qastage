# language: pt
Funcionalidade: Carga na API de clientes

  # Só roda em ambiente autorizado: URL local ou QASTAGE_LOAD_ENVS no .env.
  Contexto:
    Dado que a API é descrita em "examples/api-demo/openapi.json"
    E que eu faço login em "POST /auth/login" com:
      | email | qa@empresa.com |
      | senha | segredo        |

  Cenário: Consulta e cadastro no dia a dia
    Dado 5 usuários virtuais por "8s"
    E cada usuário espera "500ms" entre as requisições
    E cada usuário executa:
      | endpoint       | peso |
      | GET /clientes  | 3    |
      | POST /clientes | 1    |
    Então o p95 deve ser menor que 1000 ms
    E a taxa de erro deve ser menor que "1%"
    E a vazão deve ser maior que 5 requisições por segundo
