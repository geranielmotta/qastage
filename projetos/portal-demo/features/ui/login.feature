# language: pt
Funcionalidade: Login no sistema de demonstração

  Contexto:
    Dado que eu acesso "/login"

  Cenário: Login com sucesso
    Quando eu preencho "E-mail" com "qa@empresa.com"
    E eu preencho "Senha" com "segredo"
    E eu seleciono "Desenvolvedor" em "Perfil"
    E eu marco "Lembrar de mim"
    E eu clico em "Entrar"
    Então eu devo estar em "/painel"
    E eu devo ver "Bem-vindo, qa@empresa.com"
    E eu devo ver "Perfil: Desenvolvedor"

  Cenário: Senha errada mostra erro e mantém o e-mail
    Quando eu preencho "E-mail" com "qa@empresa.com"
    E eu preencho "Senha" com "errada"
    E eu clico em "Entrar"
    Então eu devo ver "Credenciais inválidas"
    E o campo "E-mail" deve conter "qa@empresa.com"
    E eu devo estar em "/login"
