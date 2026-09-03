const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js')
const cron = require('node-cron')

const TOKEN = process.env.TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const SAVE_CHANNEL_ID = process.env.SAVE_CHANNEL_ID

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

let scheduledMessages = []
let saveMessageId = null
let cronJobs = new Map()

async function saveData() {
  try {
    const channel = await client.channels.fetch(SAVE_CHANNEL_ID)
    const content = 'SCHEDULEDATA:' + JSON.stringify({ scheduledMessages, saveMessageId: null })
    if (saveMessageId) {
      const msg = await channel.messages.fetch(saveMessageId)
      await msg.edit(content)
    } else {
      const msg = await channel.send(content)
      saveMessageId = msg.id
    }
  } catch (e) {
    console.error('Erreur sauvegarde:', e.message)
  }
}

async function loadData() {
  try {
    const channel = await client.channels.fetch(SAVE_CHANNEL_ID)
    const messages = await channel.messages.fetch({ limit: 20 })
    const dataMsg = messages.find(m => m.author.id === client.user.id && m.content.startsWith('SCHEDULEDATA:'))
    if (dataMsg) {
      const parsed = JSON.parse(dataMsg.content.replace('SCHEDULEDATA:', ''))
      scheduledMessages = parsed.scheduledMessages || []
      saveMessageId = dataMsg.id
      console.log('Donnees chargees - ' + scheduledMessages.length + ' annonces programmees')
    }
  } catch (e) {
    console.log('Pas de donnees existantes')
  }
}

function scheduleMessage(msg) {
  const date = new Date(msg.datetime)
  const now = new Date()

  if (date <= now) return

  const delay = date.getTime() - now.getTime()

  const timeout = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(msg.channelId)

      if (msg.imageUrl) {
        await channel.send({ content: msg.content, files: [msg.imageUrl] })
      } else {
        await channel.send({ content: msg.content })
      }

      scheduledMessages = scheduledMessages.filter(m => m.id !== msg.id)
      cronJobs.delete(msg.id)
      await saveData()

      console.log('Annonce envoyee: ' + msg.id)
    } catch (e) {
      console.error('Erreur envoi annonce:', e.message)
    }
  }, delay)

  cronJobs.set(msg.id, timeout)
}

function generateId() {
  return Math.random().toString(36).substr(2, 9).toUpperCase()
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('programmer')
      .setDescription('Programmer une annonce (admin)')
      .addChannelOption(o => o.setName('canal').setDescription('Canal de destination').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('Date au format JJ/MM/AAAA').setRequired(true))
      .addStringOption(o => o.setName('heure').setDescription('Heure au format HH:MM').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Contenu de l\'annonce').setRequired(true))
      .addStringOption(o => o.setName('image').setDescription('URL de l\'image (optionnel)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('listannonces')
      .setDescription('Voir toutes les annonces programmees'),

    new SlashCommandBuilder()
      .setName('annulerannonce')
      .setDescription('Annuler une annonce programmee (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID de l\'annonce').setRequired(true)),

    new SlashCommandBuilder()
      .setName('modifierannonce')
      .setDescription('Modifier une annonce programmee (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID de l\'annonce').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Nouveau message').setRequired(false))
      .addStringOption(o => o.setName('date').setDescription('Nouvelle date JJ/MM/AAAA').setRequired(false))
      .addStringOption(o => o.setName('heure').setDescription('Nouvelle heure HH:MM').setRequired(false))
      .addStringOption(o => o.setName('image').setDescription('Nouvelle URL image').setRequired(false))

  ].map(c => c.toJSON())

  const rest = new REST({ version: '10' }).setToken(TOKEN)
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
  console.log('Commandes enregistrees')
}

client.on('ready', async () => {
  console.log('Bot connecte: ' + client.user.tag)
  await registerCommands()
  await loadData()

  for (const msg of scheduledMessages) {
    scheduleMessage(msg)
  }
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return

  const isAdmin = interaction.member.permissions.has('Administrator')

  if (interaction.commandName === 'programmer') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusee.', ephemeral: true })

    const canal = interaction.options.getChannel('canal')
    const date = interaction.options.getString('date')
    const heure = interaction.options.getString('heure')
    const message = interaction.options.getString('message')
    const image = interaction.options.getString('image') || null

    const [jour, mois, annee] = date.split('/')
    const [heures, minutes] = heure.split(':')
    const datetime = new Date(annee, mois - 1, jour, heures, minutes, 0)

    if (isNaN(datetime.getTime()) || datetime <= new Date()) {
      return interaction.reply({ content: 'Date ou heure invalide. Verifie le format JJ/MM/AAAA et HH:MM.', ephemeral: true })
    }

    const id = generateId()
    const newMsg = { id, channelId: canal.id, channelName: canal.name, datetime: datetime.toISOString(), content: message, imageUrl: image }
    scheduledMessages.push(newMsg)
    scheduleMessage(newMsg)
    await saveData()

    const embed = new EmbedBuilder()
      .setTitle('Annonce programmee !')
      .setDescription(
        `**ID :** ${id}\n` +
        `**Canal :** <#${canal.id}>\n` +
        `**Date :** ${date} a ${heure}\n` +
        `**Message :** ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}\n` +
        `**Image :** ${image ? 'Oui' : 'Non'}`
      )
      .setColor('#00C853')
      .setTimestamp()

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }

  if (interaction.commandName === 'listannonces') {
    if (!scheduledMessages.length) {
      return interaction.reply({ content: 'Aucune annonce programmee.', ephemeral: true })
    }

    const sorted = [...scheduledMessages].sort((a, b) => new Date(a.datetime) - new Date(b.datetime))

    const desc = sorted.map(msg => {
      const date = new Date(msg.datetime)
      const dateStr = date.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
      return `**[${msg.id}]** <#${msg.channelId}> - ${dateStr}\n${msg.content.substring(0, 60)}${msg.content.length > 60 ? '...' : ''}`
    }).join('\n\n')

    const embed = new EmbedBuilder()
      .setTitle('Annonces programmees (' + scheduledMessages.length + ')')
      .setDescription(desc)
      .setColor('#00C853')

    await interaction.reply({ embeds: [embed], ephemeral: true })
  }

  if (interaction.commandName === 'annulerannonce') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusee.', ephemeral: true })

    const id = interaction.options.getString('id').toUpperCase()
    const index = scheduledMessages.findIndex(m => m.id === id)

    if (index === -1) return interaction.reply({ content: 'Annonce introuvable avec cet ID.', ephemeral: true })

    if (cronJobs.has(id)) {
      clearTimeout(cronJobs.get(id))
      cronJobs.delete(id)
    }

    scheduledMessages.splice(index, 1)
    await saveData()

    await interaction.reply({ content: `Annonce **${id}** annulee.`, ephemeral: true })
  }

  if (interaction.commandName === 'modifierannonce') {
    if (!isAdmin) return interaction.reply({ content: 'Permission refusee.', ephemeral: true })

    const id = interaction.options.getString('id').toUpperCase()
    const index = scheduledMessages.findIndex(m => m.id === id)

    if (index === -1) return interaction.reply({ content: 'Annonce introuvable avec cet ID.', ephemeral: true })

    const msg = scheduledMessages[index]

    const newMessage = interaction.options.getString('message')
    const newDate = interaction.options.getString('date')
    const newHeure = interaction.options.getString('heure')
    const newImage = interaction.options.getString('image')

    if (newMessage) msg.content = newMessage
    if (newImage) msg.imageUrl = newImage

    if (newDate || newHeure) {
      const dateStr = newDate || new Date(msg.datetime).toLocaleDateString('fr-FR')
      const heureStr = newHeure || new Date(msg.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      const [jour, mois, annee] = dateStr.split('/')
      const [heures, minutes] = heureStr.split(':')
      const datetime = new Date(annee, mois - 1, jour, heures, minutes, 0)

      if (isNaN(datetime.getTime()) || datetime <= new Date()) {
        return interaction.reply({ content: 'Date ou heure invalide.', ephemeral: true })
      }

      msg.datetime = datetime.toISOString()

      if (cronJobs.has(id)) {
        clearTimeout(cronJobs.get(id))
        cronJobs.delete(id)
      }

      scheduleMessage(msg)
    }

    scheduledMessages[index] = msg
    await saveData()

    await interaction.reply({ content: `Annonce **${id}** modifiee.`, ephemeral: true })
  }
})

client.login(TOKEN)
