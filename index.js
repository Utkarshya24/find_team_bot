const {
    Client,
    Colors,
    GatewayIntentBits,
    ChannelType,
    Partials,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
  } = require('discord.js');
  
  require('dotenv').config();
  
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
  
  const TOKEN = process.env.TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;
  
  let teams = [];
  let teamSize = 4;
  
  client.once('ready', () => {
    console.log(`✅ Bot ready as ${client.user.tag}`);
  });
  
  // ─── Slash Commands ───────────────────────────────────────────────────────────
  const commands = [
    new SlashCommandBuilder()
      .setName('setup-teams')
      .setDescription('Setup team size and voice channels')
      .addIntegerOption(opt =>
        opt.setName('size').setDescription('Team size (e.g. 3, 4, 5)').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
    new SlashCommandBuilder()
      .setName('setup-buttons')
      .setDescription('Post team join/switch buttons')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];
  
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  
  (async () => {
    try {
      console.log('🚀 Registering slash commands...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands,
      });
      console.log('✅ Slash commands registered.');
    } catch (err) {
      console.error('❌ Error registering commands:', err);
    }
  })();
  
  // ─── Slash Command Handler ─────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
  
    if (interaction.commandName === 'setup-teams') {
      teamSize = interaction.options.getInteger('size');
      teams = [];
      await interaction.reply({
        content: `✅ Team size set to ${teamSize}`,
        ephemeral: true,
      });
    }
  
    if (interaction.commandName === 'setup-buttons') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('join_team')
          .setLabel('Join New Team')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('switch_team')
          .setLabel('Switch Team')
          .setStyle(ButtonStyle.Secondary)
      );
  
      await interaction.reply({
        content: '🎯 Choose an action:',
        components: [row],
        ephemeral: true,
      });
    }
  });
  
  // ─── Button Interaction Handler ────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
  
    const member = await interaction.guild.members.fetch(interaction.user.id);
  
    if (interaction.customId === 'join_team') {
      // Show modal directly before deferring
      const modal = new ModalBuilder()
        .setCustomId('create_team_modal')
        .setTitle('Create New Team')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('team_name_input')
              .setLabel('Enter new team name')
              .setStyle(TextInputStyle.Short)
              .setMinLength(2)
              .setMaxLength(20)
              .setRequired(true)
          )
        );
  
      // Show the modal directly
      await interaction.showModal(modal);
  
      // Defer the reply
      await interaction.deferReply({ ephemeral: true });
    }
  
    if (interaction.customId === 'switch_team') {
      await interaction.deferReply({ ephemeral: true });
  
      const team = getTeamByMemberId(member.id);
      if (team) {
        team.members = team.members.filter(id => id !== member.id);
        await removeRoleFromMember(interaction, team.name, member);
      }
  
      await interaction.editReply({ content: '🔄 You have left your team. Press Join to reassign.' });
    }
  });
  
  // ─── Modal Submission Handler ──────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'create_team_modal') return;
  
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const newTeamName = interaction.fields.getTextInputValue('team_name_input').trim();
  
    const voiceChannel = await createVoiceChannel(interaction.guild, newTeamName, member);
    teams.push({ name: newTeamName, members: [member.id], vc: voiceChannel.id });
  
    // 🛠️ Fix: Defer the reply before calling handleJoin
    await interaction.deferReply({ ephemeral: true });
  
    await handleJoin(interaction, newTeamName, member, false);
  });
  
  // ─── Helpers ───────────────────────────────────────────────────────────────────
  
  function getTeamByMemberId(memberId) {
    return teams.find(t => t.members.includes(memberId));
  }
  
  async function createVoiceChannel(guild, name, member) {
    return await guild.channels.create({
      name: `Team-${name}`,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.Connect] },
        { id: member.id, allow: [PermissionsBitField.Flags.Connect] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.MoveMembers] },  // MoveMembers flag
      ],
    });
  }
  
  async function moveToVoice(interaction, teamName, member) {
    const voiceChannel = interaction.guild.channels.cache.find(
      ch => ch.name === `Team-${teamName}` && ch.type === ChannelType.GuildVoice
    );
  
    if (!voiceChannel) {
      console.error(`Voice channel Team-${teamName} not found!`);
      return;
    }
  
    console.log(`Moving ${member.user.tag} to voice channel ${voiceChannel.name}`);
  
    if (member.voice.channel) {
      await member.voice.setChannel(voiceChannel);
    } else {
      await interaction.deferReply({ ephemeral: true });
      await interaction.followUp({
        content: `🎧 Please join any VC so I can move you to **Team-${teamName}**.`,
        ephemeral: true,
      });
    }
  }
  
  async function createTeamRole(guild, teamName) {
    return await guild.roles.create({
      name: `Team-${teamName}`,
      color: Colors.Blue, // Use Colors.BLUE instead of "BLUE"
      reason: `Auto-created team role for ${teamName}`,
    });
  }
  
  async function assignRoleToMember(interaction, teamName, member) {
    let role = interaction.guild.roles.cache.find(r => r.name === `Team-${teamName}`);
    if (!role) {
      role = await createTeamRole(interaction.guild, teamName);
    }
    await member.roles.add(role);
  }
  
  async function removeRoleFromMember(interaction, teamName, member) {
    const role = interaction.guild.roles.cache.find(r => r.name === `Team-${teamName}`);
    if (role) {
      await member.roles.remove(role);
    }
  }
  
  async function handleJoin(interaction, teamName, member, isExistingTeam) {
    await moveToVoice(interaction, teamName, member);
    await assignRoleToMember(interaction, teamName, member);
    const message = isExistingTeam
      ? `✅ You joined team **${teamName}**`
      : `✅ New team **${teamName}** created and joined!`;
  
    // Make sure you reply after all actions are complete
    await interaction.followUp({ content: message, ephemeral: true });
  }
  
  client.login(TOKEN);
  