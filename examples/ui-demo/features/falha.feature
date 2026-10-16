# language: pt
Funcionalidade: Falha proposital (demonstra o pacote de falha do F2)

  Cenário: Painel mostra o saldo
    Dado que eu acesso "/login"
    Quando eu preencho "E-mail" com "qa@empresa.com"
    E eu preencho "Senha" com "segredo"
    E eu clico em "Entrar"
    Então eu devo ver "Saldo disponível"
