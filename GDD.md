# GDD — Turbo Circuit 3D

## 1. Título
Turbo Circuit 3D

## 2. Sobre o jogo
Turbo Circuit 3D é um jogo de corrida em 3D. O jogador controla um carro em uma pista e compete para completar três voltas no menor tempo possível.

## 3. Objetivo
Completar a corrida, controlar o carro nas curvas e tentar fazer o melhor tempo.

## 4. Tecnologias utilizadas
- HTML: estrutura da página do jogo.
- CSS: aparência da interface.
- JavaScript: lógica e controles.
- Three.js: criação e renderização do cenário 3D.
- GLTF/GLB: modelos 3D dos carros.

## 5. Controles
- W ou seta para cima: acelerar.
- S ou seta para baixo: frear ou andar de ré.
- A/D ou setas esquerda/direita: virar.
- Espaço: freio de mão.
- P: pausar.
- Enter: reiniciar após a chegada.

## 6. Regras e progresso
A corrida tem três voltas. A interface mostra a volta atual, a posição, o tempo, a melhor volta e a velocidade. Ao terminar, aparece a tela de resultado e a opção de jogar novamente.

## 7. Organização do projeto
- `index.html`: estrutura do jogo.
- `style.css`: estilos visuais.
- `script.js`: dados dos modelos 3D embutidos.
- `game.js`: lógica principal do jogo em Three.js.
- `assets/imagens/`: imagens extras, se forem necessárias.
- `assets/sons/`: sons extras, se forem necessários.
- `assets/fontes/`: fontes extras, se forem necessárias.

## 8. Apoio de inteligência artificial
A inteligência artificial foi usada como apoio para organizar os arquivos, corrigir problemas e melhorar o funcionamento do jogo.

## 9. Como executar
Abra a pasta do projeto no Visual Studio Code e execute `index.html` usando uma extensão como Live Server. Como o jogo usa módulos do navegador, é recomendado abrir por um servidor local em vez de abrir o arquivo diretamente.
