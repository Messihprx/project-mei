def eh_palindromo(texto):
    # Remove espaços e pontuações, e converte para minúsculas
    texto_limpo = ''.join(e for e in texto if e.isalnum()).lower()
    
    # Verifica se o texto é igual ao seu reverso
    return texto_limpo == texto_limpo[::-1]

# Solicita entrada do usuário
entrada = input("Digite uma palavra ou frase: ")

# Verifica e informa se é um palíndromo
if eh_palindromo(entrada):
    print("É um palíndromo!")
else:
    print("Não é um palíndromo.")